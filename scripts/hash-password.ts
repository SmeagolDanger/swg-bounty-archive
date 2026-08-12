import bcrypt from "bcryptjs";

const args = process.argv.slice(2);
const envFormat = args[0] === "--env";
const password = args[envFormat ? 1 : 0];
if (!password) {
  throw new Error("Usage: npm run admin:hash-password -- [--env] 'your password'");
}

const hash = await bcrypt.hash(password, 12);
process.stdout.write(envFormat ? `ADMIN_PASSWORD_HASH='${hash}'\n` : `${hash}\n`);
