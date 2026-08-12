import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) throw new Error("Usage: npm run admin:hash-password -- 'your password'");
process.stdout.write(`${await bcrypt.hash(password, 12)}\n`);
