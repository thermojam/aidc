import {test} from "node:test";
import assert from "node:assert/strict";
import {generationCommand} from "./modelSource.ts";

test("source keeps matching model names out of SimpleClaw for send and retry", () => {
    for (const model of ["same:latest", "local-mock", "gpt-oss-20b"]) {
        assert.equal(generationCommand("ollama", model, false), "start_ollama_generation");
        assert.equal(generationCommand("ollama", model, true), null);
    }
    assert.equal(generationCommand("simpleclaw", "same:latest", false), "start_generation");
    assert.equal(generationCommand("simpleclaw", "same:latest", true), "retry_generation");
    assert.equal(generationCommand("simpleclaw", "local-mock", false), "start_mock_generation");
    assert.equal(generationCommand("simpleclaw", "local-mock", true), "retry_mock_generation");
});
