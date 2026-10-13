import { MongoClient, MongoServerError } from "mongodb";

// This command configures only the local server started by compose.yaml.
const client = new MongoClient(
  "mongodb://127.0.0.1:27017/?directConnection=true",
  { serverSelectionTimeoutMS: 5_000 },
);

try {
  await client.connect();
  const admin = client.db("admin");

  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.set !== "rs0") {
      throw new Error("Expected the local replica set to be named rs0.");
    }
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 94) {
      throw error;
    }
    await admin.command({
      replSetInitiate: {
        _id: "rs0",
        members: [{ _id: 0, host: "localhost:27017" }],
      },
    });
  }

  const deadline = Date.now() + 20_000;
  while (true) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary && hello.setName === "rs0") break;
    if (Date.now() >= deadline) {
      throw new Error("MongoDB did not become ready within 20 seconds.");
    }
    await Bun.sleep(250);
  }
  console.log("Local MongoDB is ready at 127.0.0.1:27017 (replica set rs0).");
} finally {
  await client.close();
}
