import { MongoClient } from "mongodb";

export const localMongoUri =
  "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";

export async function connectMongo({
  uri = process.env.MONGODB_URI ?? localMongoUri,
  database = process.env.MONGODB_DATABASE ?? "stillgotit",
}: { uri?: string; database?: string } = {}) {
  const client = new MongoClient(uri, {
    appName: "StillGotIt",
    serverSelectionTimeoutMS: 5_000,
    writeConcern: { w: "majority", j: true },
  });

  try {
    await client.connect();
    const db = client.db(database);
    await db.command({ ping: 1 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
