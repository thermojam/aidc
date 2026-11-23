export type ModelSource = "simpleclaw" | "ollama";

export function generationCommand(source: ModelSource, modelId: string, retry: boolean): string | null {
    if (source === "ollama") return retry ? "retry_generation" : "start_ollama_generation";
    if (modelId === "local-mock") return retry ? "retry_mock_generation" : "start_mock_generation";
    return retry ? "retry_generation" : "start_generation";
}
