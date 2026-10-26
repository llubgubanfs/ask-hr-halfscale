const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
const hb = JSON.parse(fs.readFileSync(path.join(dir, 'handbook.json'), 'utf8'));
const faq = JSON.parse(fs.readFileSync(path.join(dir, 'faq-seed.json'), 'utf8')).questions;
const byId = Object.fromEntries(hb.policies.map(p => [p.id, p]));
module.exports = { handbook: hb, policies: hb.policies, byId, faq };
