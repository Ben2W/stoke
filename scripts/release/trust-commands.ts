import { releasePackages } from "./config";

const repository = process.env.GITHUB_REPOSITORY ?? "freestyle-sh/rigkit";

const trustedWorkflows = ["publish-npm.yml", "canary-main.yml", "canary.yml"];

for (const pkg of releasePackages) {
  for (const file of trustedWorkflows) {
    console.log(
      `npx npm@latest trust github ${pkg.name} --repo ${repository} --file ${file} -y`,
    );
  }
}
