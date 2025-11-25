const postgres = require("postgres");
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    content.split("\n").forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnvFile();

async function dropAllTables() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set.");
    console.error("Please set it in your .env.local file or export it.");
    process.exit(1);
  }

  const client = postgres(databaseUrl, { prepare: false });

  try {
    console.log("Connecting to database...");

    const tables = await client`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;

    if (tables.length === 0) {
      console.log("No tables found in the database.");
      await client.end();
      return;
    }

    console.log(`Found ${tables.length} table(s):`);
    tables.forEach((table) => {
      console.log(`  - ${table.tablename}`);
    });

    const enums = await client`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY typname;
    `;

    if (enums.length > 0) {
      console.log(`\nFound ${enums.length} enum type(s):`);
      enums.forEach((enumType) => {
        console.log(`  - ${enumType.typname}`);
      });
    }

    console.log("\nDropping all tables and enums...");

    for (const table of tables) {
      await client.unsafe(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE;`);
      console.log(`  ✓ Dropped table: ${table.tablename}`);
    }

    for (const enumType of enums) {
      await client.unsafe(`DROP TYPE IF EXISTS "${enumType.typname}" CASCADE;`);
      console.log(`  ✓ Dropped enum: ${enumType.typname}`);
    }

    console.log("\n✓ All tables and enums dropped successfully!");
  } catch (error) {
    console.error("Error dropping tables:", error);
    throw error;
  } finally {
    await client.end();
  }
}

dropAllTables()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nFailed:", error);
    process.exit(1);
  });

