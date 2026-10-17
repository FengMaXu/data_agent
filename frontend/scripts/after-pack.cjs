// electron-builder afterPack hook: stamps the app icon and yourdb's version details into the Windows exe.
// `win.signAndEditExecutable` stays off because its winCodeSign download fails to extract
// without symlink privileges, and that switch is also what normally sets the icon and details,
// leaving Electron's own ("Electron", "GitHub, Inc.") in Task Manager and file properties.
const path = require('node:path');

const BRAND = 'yourdb';
const ATTEMPTS = 12;
const RETRY_MS = 5000;

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;
    const { rcedit } = await import('rcedit');
    const { productFilename, version } = context.packager.appInfo;
    const exeName = `${productFilename}.exe`;
    const exe = path.join(context.appOutDir, exeName);
    const options = {
        icon: path.join(__dirname, '..', 'resources', 'icon.ico'),
        'file-version': version,
        'product-version': version,
        'version-string': {
            CompanyName: BRAND,
            FileDescription: BRAND,
            ProductName: BRAND,
            InternalName: exeName,
            OriginalFilename: exeName,
            LegalCopyright: `Copyright (C) ${new Date().getFullYear()} ${BRAND}`,
        },
    };
    // Antivirus scanning holds a freshly written exe for a while, which rcedit reports as
    // "Unable to commit changes", so keep retrying until the scan lets go.
    for (let attempt = 1; ; attempt += 1) {
        try {
            await rcedit(exe, options);
            return;
        } catch (error) {
            if (attempt >= ATTEMPTS) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
    }
};
