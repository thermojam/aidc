import {act, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {mockIPC} from "@tauri-apps/api/mocks";
import ImageGenerationView from "./ImageGenerationView";
import {useImageGeneration} from "./useImageGeneration";
import type {ModelCatalog} from "../../modelCatalog";

const initial: ModelCatalog = {fetched_at: 1, models: [{id: "image", name: "Image", protocols: ["images_generations"], request_rubles: 1, input_rubles_per_million: null, output_rubles_per_million: null, audio_rubles_per_minute: null}]};
let calls = 0, saves = 0, approve = true, rejectNext = false;
let complete: (value: unknown) => void = () => {};
mockIPC((command) => {
    if (command === "generate_image") {
        calls++;
        if (rejectNext) return Promise.reject("NETWORK_RESULT_UNKNOWN");
        return new Promise((resolve) => { complete = resolve; });
    }
    if (command === "save_generated_image") { saves++; return true; }
    throw new Error(`unexpected ${command}`);
});

function Harness() {
    const [catalog, setCatalog] = useState<ModelCatalog | null>(initial);
    const [open, setOpen] = useState(true);
    const backRef = useRef<HTMLButtonElement>(null);
    const image = useImageGeneration({catalog, setCatalog, confirmAction: async () => approve, clear: () => {}, report: () => {}});
    return <><button id="toggle" onClick={() => setOpen(!open)}>toggle</button>{open && <ImageGenerationView image={image} catalog={catalog} backRef={backRef} onBack={() => setOpen(false)} onRefresh={() => {}} errors={null}/>}</>;
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function button(text: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
    check(found, `button missing: ${text}`); return found;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }

async function run() {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<Harness/>));
    const textarea = document.querySelector("textarea")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "synthetic prompt");
        textarea.dispatchEvent(new Event("input", {bubbles: true}));
    });
    approve = false;
    await click(button("Проверить цену"));
    check(calls === 0, "cancelled confirmation sent a request");
    approve = true;
    await click(button("Проверить цену"));
    check(Number(calls) === 1, "expected one request");
    await click(button("К беседе"));
    await act(async () => complete({model_id: "image", price_rubles: 1, data_url: "data:image/png;base64,c3ludGhldGlj"}));
    await click(button("toggle"));
    check(document.querySelector(".generated-image-result img"), "result lost after view unmount");
    await click(button("Сохранить PNG"));
    check(saves === 1 && Number(calls) === 1, "save or request count wrong");
    rejectNext = true;
    await click(button("Проверить цену"));
    check(Number(calls) === 2, "unknown request did not start");
    await click(button("К беседе"));
    await click(button("toggle"));
    check(button("Проверить цену").disabled && document.body.textContent?.includes("повтор этого же запроса заблокирован"), "unknown request not blocked after unmount");
    await act(async () => root.unmount());
}

run().then(() => { document.getElementById("result")!.textContent = "PASS"; }, (error) => { document.getElementById("result")!.textContent = `FAIL: ${String(error)}`; });
