const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('PAGE ERROR:', msg.text());
        }
    });
    page.on('pageerror', error => {
        console.log('PAGE UNCAUGHT ERROR:', error.message);
    });
    await page.goto(`file:///${__dirname.replace(/\\/g, '/')}/arena.html`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
})();
