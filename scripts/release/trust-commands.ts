import { releasePackages } from "./config";

const repository = process.env.GITHUB_REPOSITORY ?? "freestyle-sh/rigkit";

for (const pkg of releasePackages) {
  console.log(
    `npx npm@latest trust github ${pkg.name} --repo ${repository} --file publish-npm.yml -y`,
  );
}
