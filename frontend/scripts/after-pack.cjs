// electron-builder afterPack hook: stamps the app icon into the Windows exe.
// `win.signAndEditExecutable` stays off because its winCodeSign download fails to extract
// without symlink privileges, and that switch is also what normally sets the exe icon.
const path = require('node:path');

const ATTEMPTS = 12;
const RETRY_MS = 5000;

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;
    const { rcedit } = await import('rcedit');
    const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    const icon = path.join(__dirname, '..', 'resources', 'icon.ico');
    // Antivirus scanning holds a freshly written exe for a while, which rcedit reports as
    // "Unable to commit changes", so keep retrying until the scan lets go.
    for (let attempt = 1; ; attempt += 1) {
        try {
            await rcedit(exe, { icon });
            return;
        } catch (error) {
            if (attempt >= ATTEMPTS) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
    }
};
