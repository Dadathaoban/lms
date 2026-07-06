const validate = (fields) => {
    return (req, res, next) => {
        for (const [key, rules] of Object.entries(fields)) {
            const value = req.body[key];

            if (rules.required && (value === undefined || value === null || String(value).trim() === '')) {
                return res.status(400).send(`${key} is required.`);
            }

            if (value !== undefined && value !== null && String(value).trim() !== '') {
                if (rules.minLength && String(value).trim().length < rules.minLength) {
                    return res.status(400).send(`${key} must be at least ${rules.minLength} characters.`);
                }
                if (rules.maxLength && String(value).trim().length > rules.maxLength) {
                    return res.status(400).send(`${key} must be at most ${rules.maxLength} characters.`);
                }
                if (rules.pattern && !rules.pattern.test(String(value).trim())) {
                    return res.status(400).send(`${key} format is invalid.`);
                }
                if (rules.oneOf && !rules.oneOf.includes(String(value).trim().toUpperCase())) {
                    return res.status(400).send(`${key} must be one of: ${rules.oneOf.join(', ')}.`);
                }
            }
        }
        next();
    };
};

module.exports = { validate };
