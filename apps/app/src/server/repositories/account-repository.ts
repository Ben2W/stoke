import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.ts";
import { account } from "../db/schema.ts";

export const accountRepository = {
  async findGitHubAccessToken(userId: string): Promise<string | undefined> {
    const [row] = await getDatabase()
      .select({ accessToken: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
      .orderBy(desc(account.updatedAt))
      .limit(1);
    return row?.accessToken ?? undefined;
  },
};
