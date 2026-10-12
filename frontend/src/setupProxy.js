// Loaded automatically by the CRA dev server (react-scripts start). Adds the security
// headers that cannot be delivered through <meta> tags. Production equivalent: deploy/nginx.conf
module.exports = function (app) {
    const csp = `${process.env.REACT_APP_CSP}; frame-ancestors 'none'`;

    app.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        next();
    });
};
