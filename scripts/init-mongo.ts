import { MongoClient } from "mongodb";

// Waits for the local standalone server started by compose.yaml. Like the 6.1040 Apps
// platform, it has no replica set, so any code that needs a transaction fails locally too.
const client = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", { serverSelectionTimeoutMS: 20_000 });

try {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  console.log("Local MongoDB is ready at 127.0.0.1:27017.");
} finally {
  await client.close();
}
