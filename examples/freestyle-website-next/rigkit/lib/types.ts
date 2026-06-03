export type SnapshotContext = {
  snapshotId: string;
};

export type WebsiteContext = SnapshotContext & {
  repoPath: string;
  repo: string;
  devCommand: string;
  devSessionName: string;
  devPort: number;
};

export type WebsiteWorkspaceContext = Omit<WebsiteContext, "snapshotId"> & {
  vmId: string;
  branch: string;
};
