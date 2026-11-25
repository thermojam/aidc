import {useRef, useState, type Dispatch, type SetStateAction} from "react";
import {invoke} from "@tauri-apps/api/core";
import type {ModelCatalog} from "../../modelCatalog";

type GeneratedImage = { model_id: string; price_rubles: number; data_url: string };

type Options = {
    catalog: ModelCatalog | null;
    setCatalog: Dispatch<SetStateAction<ModelCatalog | null>>;
    confirmAction: (message: string) => Promise<boolean>;
    clear: (operation: string) => void;
    report: (operation: string, reason: unknown) => void;
};

export function useImageGeneration({catalog, setCatalog, confirmAction, clear, report}: Options) {
    const [imagePrompt, setImagePrompt] = useState("");
    const [imageModelId, setImageModelId] = useState("");
    const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
    const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
    const [imageSaved, setImageSaved] = useState(false);
    const [imageSaving, setImageSaving] = useState(false);
    const imageSavePending = useRef(false);
    const [uncertainImageSignatures, setUncertainImageSignatures] = useState<Set<string>>(new Set());
    const imageRequestPending = useRef(false);
    const imageModels = catalog?.models.filter((model) => model.protocols.includes("images_generations")) ?? [];
    const selectedImageModel = imageModels.find((model) => model.id === imageModelId) ?? imageModels[0];
    async function generateImage() {
        const selectedImageModelId = selectedImageModel?.id || "";
        const model = catalog?.models.find((item) => item.id === selectedImageModelId);
        if (!model || !model.protocols.includes("images_generations") || model.request_rubles === null) return;
        const signature = JSON.stringify([selectedImageModelId, imagePrompt.trim()]);
        if (imageRequestPending.current || imageSavePending.current || uncertainImageSignatures.has(signature)) return;
        if (!await confirmAction(`Отправить запрос в SimpleClaw?\nМодель: ${model.name} (${model.id})\nЦена: ${model.request_rubles} ₽ за успешный запрос. Автоповтора не будет.`)) return;
        imageRequestPending.current = true;
        setImageGenerationBusy(true);
        setGeneratedImage(null);
        setImageSaved(false);
        clear("generateImage");
        try {
            setGeneratedImage(await invoke<GeneratedImage>("generate_image", {
                modelId: selectedImageModelId, prompt: imagePrompt, expectedPriceRubles: model.request_rubles
            }));
        } catch (reason) {
            const message = String(reason);
            if (message.includes("NETWORK_RESULT_UNKNOWN") || message.includes("GENERATION_RESULT_UNKNOWN") || /GENERATION_HTTP_5\d\d/.test(message)) {
                setUncertainImageSignatures((current) => new Set(current).add(signature));
                report("generateImage", "Результат генерации неизвестен; запрос мог быть принят и оплачен. Для продолжения измените описание или модель, чтобы не повторить тот же запрос.");
            } else if (message.includes("Цена изменилась")) {
                try {
                    setCatalog(await invoke<ModelCatalog>("refresh_models"));
                    report("generateImage", "Цена каталога изменилась. Проверьте новую сумму, затем подтвердите запрос ещё раз.");
                } catch (refreshReason) { report("generateImage", `Не удалось обновить цену: ${String(refreshReason)}`); }
            } else report("generateImage", message);
        }
        finally { imageRequestPending.current = false; setImageGenerationBusy(false); }
    }

    async function saveGeneratedImage() {
        if (!generatedImage || imageSavePending.current) return;
        imageSavePending.current = true;
        setImageSaving(true);
        setImageSaved(false);
        clear("saveGeneratedImage");
        try {
            const saved = await invoke<boolean>("save_generated_image", {dataUrl: generatedImage.data_url});
            setImageSaved(saved);
        } catch (reason) { report("saveGeneratedImage", reason); }
        finally { imageSavePending.current = false; setImageSaving(false); }
    }

    return {imagePrompt, setImagePrompt, imageModelId, setImageModelId, generatedImage, imageGenerationBusy,
        imageSaved, imageSaving, uncertainImageSignatures, imageModels, selectedImageModel, generateImage, saveGeneratedImage};
}
