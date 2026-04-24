import { test, expect } from '@playwright/test';

test.describe('Unit Tests: POST /api/users (Create User)', () => {
    let adminToken: string;
    let customerToken: string;
    let createdUserId: string | null = null;

    // Use a fixed timestamp for the duplicate email test to ensure exact match
    const duplicateEmail = `conflict_user_${Date.now()}@test.com`;

    test.beforeAll(async ({ request }) => {
        // Authenticate as an Owner/Admin to get a token with 'user:users:manage' permission
        const adminAuthResponse = await request.post('/api/auth-tokens', {
            data: { username: 'superadmin@test.com', password: '12345678' }
        });
        expect(adminAuthResponse.ok(), 'Failed to retrieve admin token').toBeTruthy();
        adminToken = (await adminAuthResponse.json()).accessToken;

        // Authenticate as a Customer to get a token without manage permissions (for 403 test)
        const customerAuthResponse = await request.post('/api/auth-tokens', {
            data: { username: 'customer1@test.com', password: '12345678' }
        });
        expect(customerAuthResponse.ok(), 'Failed to retrieve customer token').toBeTruthy();
        customerToken = (await customerAuthResponse.json()).accessToken;
    });

    test('should successfully create a user and verify all fields via GET /api/users/{id} (Happy Path)', async ({ request }) => {
        const uniqueId = Date.now();
        const payload = {
            name: `Happy Path User ${uniqueId}`,
            email: `happy_${uniqueId}@test.com`,
            status: 'active',
            password: 'SecurePassword123!',
            type: 'internal'
        };

        // 1. Create the user and verify the POST response (201)
        const createResponse = await request.post('/api/users', {
            headers: { 'Authorization': `Bearer ${adminToken}` },
            data: payload
        });

        expect(createResponse.status(), 'Expected 201 Created').toBe(201);
        const createdData = await createResponse.json();

        // Store ID for the afterAll cleanup hook
        createdUserId = createdData.id;

        // Verify fundamental fields in the POST response
        expect(createdData.id).toBeDefined();
        expect(createdData.name).toBe(payload.name);
        expect(createdData.email).toBe(payload.email);

        // 2. Fetch the user by ID and verify the GET response (200)
        const getResponse = await request.get(`/api/users/${createdUserId}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        expect(getResponse.status(), 'Expected 200 OK on GET request').toBe(200);
        const fetchedData = await getResponse.json();

        // 3. Strict assertion of all fields according to API documentation
        expect(fetchedData.id).toBe(createdUserId);
        expect(fetchedData.email).toBe(payload.email);
        expect(fetchedData.name).toBe(payload.name);
        expect(fetchedData.type).toBe(payload.type);
        expect(fetchedData.status).toBe(payload.status);

        // Identity ID should exist and be a string
        expect(typeof fetchedData.identityId).toBe('string');

        // CreatedAt should match standard ISO date-time format
        expect(typeof fetchedData.createdAt).toBe('string');
        expect(Date.parse(fetchedData.createdAt)).not.toBeNaN();

        // Permissions should be an array (even if empty)
        expect(Array.isArray(fetchedData.permissions)).toBeTruthy();
    });

    test('should return 401 Unauthorized when JWT token is missing', async ({ request }) => {
        // Attempt to create a user without the Authorization header
        const response = await request.post('/api/users', {
            data: {
                name: 'Anonymous User',
                email: 'anonymous@test.com',
                status: 'active',
                password: 'SecurePassword123!',
                type: 'internal'
            }
        });

        expect(response.status()).toBe(401);
    });

    test('should return 403 Forbidden when user lacks required permissions', async ({ request }) => {
        // Attempt to create a user using a token that belongs to an external customer
        const response = await request.post('/api/users', {
            headers: { 'Authorization': `Bearer ${customerToken}` },
            data: {
                name: 'Hacker User',
                email: 'hacker@test.com',
                status: 'active',
                password: 'SecurePassword123!',
                type: 'internal'
            }
        });

        expect(response.status()).toBe(403);
    });

    test('should return 400 Bad Request when payload validation fails (password length)', async ({ request }) => {
        // Provide an invalid password (less than 8 characters) to trigger schema validation error
        const response = await request.post('/api/users', {
            headers: { 'Authorization': `Bearer ${adminToken}` },
            data: {
                name: 'Invalid User',
                email: `invalid_${Date.now()}@test.com`,
                status: 'active',
                password: 'short', // Invalid value
                type: 'internal'
            }
        });

        expect(response.status()).toBe(400);
    });

    test('should return 409 Conflict when creating a user with an already existing email', async ({ request }) => {
        const payload = {
            name: 'Duplicate Test User',
            email: duplicateEmail,
            status: 'active',
            password: 'SecurePassword123!',
            type: 'internal'
        };

        // 1. Seed the database with the initial user record
        const initialResponse = await request.post('/api/users', {
            headers: { 'Authorization': `Bearer ${adminToken}` },
            data: payload
        });

        expect(initialResponse.status(), 'Failed to seed initial user for conflict test').toBe(201);
        const responseBody = await initialResponse.json();
        createdUserId = responseBody.id; // Store ID for teardown cleanup

        // 2. Attempt to create another user with the exact same payload/email
        const conflictResponse = await request.post('/api/users', {
            headers: { 'Authorization': `Bearer ${adminToken}` },
            data: payload
        });

        expect(conflictResponse.status()).toBe(409);
    });

    test.afterAll(async ({ request }) => {
        // Clean up test data robustly
        // to prevent database pollution
        if (createdUserId) {
            const deleteResponse = await request.delete(`/api/users/${createdUserId}`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            expect(deleteResponse.status(), 'Failed to clean up test user').toBeGreaterThanOrEqual(200);
        }
    });
});