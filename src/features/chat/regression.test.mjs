import {test} from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "vite";

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("generation ignores stale events and retries the saved provider", {skip: !existsSync(chrome), timeout: 30000}, async () => {
    const profile = mkdtempSync(join(tmpdir(), "aidc-generation-test-"));
    const server = await createServer({configFile: false, server: {host: "127.0.0.1", port: 0}, appType: "spa"});
    try {
        await server.listen();
        const address = server.httpServer.address();
        const {stdout} = await promisify(execFile)(chrome, ["--headless=new", "--no-first-run", "--disable-gpu", `--user-data-dir=${profile}`, "--virtual-time-budget=5000", "--dump-dom", `http://127.0.0.1:${address.port}/src/features/chat/regression.html`], {timeout: 20000});
        assert.match(stdout, /<pre id="result">PASS<\/pre>/);
    } finally {
        await server.close();
        rmSync(profile, {recursive: true, force: true});
    }
});
