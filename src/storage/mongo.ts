import { MongoClient } from "mongodb";

/** The local standalone server from compose.yaml. The path names the database, as on the platform. */
export const localMongoUri = "mongodb://127.0.0.1:27017/stillgotit?directConnection=true";

/** Connects with the database named in the URI. Tests pass their own database name. */
export async function connectMongo({
  uri = process.env.MONGODB_URI ?? localMongoUri,
  database,
}: { uri?: string; database?: string } = {}) {
  const client = new MongoClient(uri, {
    appName: "StillGotIt",
    serverSelectionTimeoutMS: 5_000,
    writeConcern: { w: "majority", j: true },
    // The platform allows 10 connections, and the old and new versions overlap during a deploy.
    ...(/[?&]maxPoolSize=/i.test(uri) ? {} : { maxPoolSize: 4 }),
  });

  try {
    await client.connect();
    const db = database === undefined ? client.db() : client.db(database);
    await db.command({ ping: 1 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
