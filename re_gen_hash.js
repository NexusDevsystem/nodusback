import bcrypt from 'bcrypt';
const pass = 'crispereiracriador';
const hash = bcrypt.hashSync(pass, 12);
console.log('PASSWORD:', pass);
console.log('HASH:', hash);
console.log('VERIFY:', bcrypt.compareSync(pass, hash));
