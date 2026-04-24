import { test, expect } from '@playwright/test';
import * as crypto from 'crypto'; // uniqueness

test.describe('Integration Tests: Users & Groups Management', () => {
    let adminToken: string;
    let customerToken: string;

    test.beforeAll(async ({ request }) => {
        // 1. Authenticate as Superadmin to get a token with management privileges
        const adminAuthRes = await request.post('/api/auth-tokens', {
            data: { username: 'superadmin@test.com', password: '12345678' }
        });
        expect(adminAuthRes.ok(), 'Failed to retrieve admin token').toBeTruthy();
        const adminBody = await adminAuthRes.json();
        adminToken = adminBody.accessToken;

        // 2. Authenticate as a Customer to verify Role-Based Access Control (RBAC)
        const customerAuthRes = await request.post('/api/auth-tokens', {
            data: { username: 'customer1@test.com', password: '12345678' }
        });
        expect(customerAuthRes.ok(), 'Failed to retrieve customer token').toBeTruthy();
        const customerBody = await customerAuthRes.json();
        customerToken = customerBody.accessToken;
    });

    test('should forbid Customer from creating groups (403 Forbidden)', async ({ request }) => {
        // Attempt to create a group using an unprivileged customer token
        const response = await request.post('/api/groups', {
            headers: { 'Authorization': `Bearer ${customerToken}` },
            data: {
                name: 'Unauthorized Group',
                description: 'Should fail'
            }
        });

        expect(response.status(), 'Expected 403 for insufficient permissions').toBe(403);
    });

    test('should execute full cycle: create user, create group, and assign user to group', async ({ request }) => {
        // unique suffix to prevent collisions during parallel browser execution
        const uniqueSuffix = crypto.randomUUID().split('-')[0];

        // Variables scoped strictly to this test to ensure parallel isolation
        let userId: string | null = null;
        let identityId: string | null = null;
        let groupId: string | null = null;
        let membershipId: string | null = null;

        try {
            // 1: Create a new Internal User
            const userRes = await request.post('/api/users', {
                headers: { 'Authorization': `Bearer ${adminToken}` },
                data: {
                    name: `Int User ${uniqueSuffix}`,
                    email: `int_user_${uniqueSuffix}@test.com`,
                    status: 'active',
                    password: 'SecurePassword123!',
                    type: 'external'
                }
            });
            expect(userRes.status(), 'Failed to create user').toBe(201);
            const userData = await userRes.json();
            userId = userData.id;
            identityId = userData.identityId;

            // 2: Create a new Group
            const groupRes = await request.post('/api/groups', {
                headers: { 'Authorization': `Bearer ${adminToken}` },
                data: {
                    name: `Int Group ${uniqueSuffix}`,
                    description: 'Automated integration test group'
                }
            });
            expect(groupRes.status(), 'Failed to create group').toBe(201);
            const groupData = await groupRes.json();
            groupId = groupData.id;
            const targetIdForGroup = identityId;

            // 3: Assign User to Group
            const memberRes = await request.post('/api/group-members', {
                headers: { 'Authorization': `Bearer ${adminToken}` },
                data: {
                    groupId: groupId,
                    userId: targetIdForGroup
                }
            });

            if (!memberRes.ok()) {
                const errorBody = await memberRes.json();
                console.error('Failed Request Payload:', { groupId, userId: targetIdForGroup });
                console.error('API Error Response:', errorBody);
            }

            expect(memberRes.status(), `Failed to add member to group. Status: ${memberRes.status()}`).toBe(201);
            const memberData = await memberRes.json();
            membershipId = memberData.id;

            // 4: Verify Membership
            const listRes = await request.get(`/api/group-members?groupId=${groupId}&page=1&perPage=20`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            expect(listRes.status(), 'Failed to fetch group members').toBe(200);

            const listData = await listRes.json();

            const responseString = JSON.stringify(listData);
            expect(responseString.includes(targetIdForGroup as string), 'User ID was not found in the group members list').toBeTruthy();

        } finally {
            // Clean up test data robustly
            // to prevent database pollution
            if (membershipId) {
                await request.delete(`/api/group-members/${membershipId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                }).catch(() => console.log(`Failed to cleanup membership: ${membershipId}`));
            }

            if (groupId) {
                await request.delete(`/api/groups/${groupId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                }).catch(() => console.log(`Failed to cleanup group: ${groupId}`));
            }

            if (userId) {
                await request.delete(`/api/users/${userId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                }).catch(() => console.log(`Failed to cleanup user: ${userId}`));
            }
        }
    });
});