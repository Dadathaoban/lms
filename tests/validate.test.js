const { validate } = require('../src/middleware/validate');

function mockReqBody(body) {
    return { body };
}

function mockRes() {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (msg) => { res.body = msg; return res; };
    return res;
}

describe('validate middleware', () => {
    it('passes when all required fields are present', () => {
        const middleware = validate({
            username: { required: true },
            password: { required: true }
        });
        const req = mockReqBody({ username: 'admin', password: 'secret' });
        const res = mockRes();
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it('rejects when required field is missing', () => {
        const middleware = validate({
            username: { required: true },
            password: { required: true }
        });
        const req = mockReqBody({ username: 'admin' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('password');
    });

    it('rejects when required field is empty string', () => {
        const middleware = validate({
            name: { required: true }
        });
        const req = mockReqBody({ name: '   ' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
    });

    it('validates minLength constraint', () => {
        const middleware = validate({
            title: { required: true, minLength: 5 }
        });
        const req = mockReqBody({ title: 'ab' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('5');
    });

    it('validates maxLength constraint', () => {
        const middleware = validate({
            title: { required: true, maxLength: 5 }
        });
        const req = mockReqBody({ title: 'abcdef' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('5');
    });

    it('validates pattern constraint', () => {
        const middleware = validate({
            phone: { pattern: /^[0-9]{7,20}$/ }
        });
        const req = mockReqBody({ phone: 'abc' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
    });

    it('validates oneOf constraint', () => {
        const middleware = validate({
            option: { required: true, oneOf: ['A', 'B', 'C', 'D'] }
        });
        const req = mockReqBody({ option: 'E' });
        const res = mockRes();
        middleware(req, res, () => {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('A, B, C, D');
    });

    it('accepts valid oneOf value (case insensitive)', () => {
        const middleware = validate({
            option: { required: true, oneOf: ['A', 'B', 'C', 'D'] }
        });
        const req = mockReqBody({ option: 'a' });
        const res = mockRes();
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it('skips validation for optional fields not provided', () => {
        const middleware = validate({
            optional_field: { minLength: 5 }
        });
        const req = mockReqBody({});
        const res = mockRes();
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });
});
