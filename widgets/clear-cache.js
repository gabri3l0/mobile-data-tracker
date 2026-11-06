// Run this utility in Scriptable, then run your carrier widget again.
const fm = FileManager.local();
const directory = fm.libraryDirectory();
let removed = 0;

for (const version of ["v1", "v2"]) {
  for (const name of [
    `mobile-data-tracker-version-${version}.json`,
    `mobile-data-tracker-telcel-usage-${version}.json`,
    `mobile-data-tracker-bait-usage-${version}.json`,
  ]) {
    const path = fm.joinPath(directory, name);
    if (fm.fileExists(path)) {
      fm.remove(path);
      console.log(`Removed: ${name}`);
      removed++;
    }
  }
}

console.log(`Done: ${removed} cache files removed.`);
Script.complete();
