import type {ReactNode, RefObject} from "react";
import type {ModelCatalog} from "../../modelCatalog";
import type {useImageGeneration} from "./useImageGeneration";

type Props = {image: ReturnType<typeof useImageGeneration>; catalog: ModelCatalog | null;
    backRef: RefObject<HTMLButtonElement | null>; onBack: () => void; onRefresh: () => void; errors: ReactNode};

export default function ImageGenerationView({image, catalog, backRef, onBack, onRefresh, errors}: Props) {
    const {imagePrompt, setImagePrompt, imageModelId, setImageModelId, generatedImage, imageGenerationBusy,
        imageSaved, imageSaving, uncertainImageSignatures, imageModels, selectedImageModel, generateImage, saveGeneratedImage} = image;
    return <section className="tasks-view" aria-label="Генерация изображений">
                <header className="chat-header"><button ref={backRef} type="button" className="secondary-button" onClick={onBack}>К беседе</button><h1>Генерация изображений</h1></header>
                <div className="tasks-content"><div className="image-generation-panel">
                    {errors}
                    <p>Поставщик: SimpleClaw. Один запрос создаёт одно изображение. Перед каждым платным запросом потребуется подтверждение.</p>
                    <label htmlFor="image-generation-model">Модель</label>
                    <select id="image-generation-model" value={selectedImageModel?.id || ""} disabled={imageGenerationBusy}
                            onChange={(event) => setImageModelId(event.target.value)}>
                        {imageModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                    </select>
                    {imageModels.length > 0 && <p>Цена: {imageModels.find((model) => model.id === (imageModelId || imageModels[0]?.id))?.request_rubles == null
                        ? "неизвестна — запрос заблокирован"
                        : `${imageModels.find((model) => model.id === (imageModelId || imageModels[0]?.id))?.request_rubles} ₽ за успешный запрос`}.
                        Источник и дата: <a href="https://simple-claw.ru/v1/models" target="_blank" rel="noreferrer">публичный каталог моделей</a>, {catalog ? new Date(catalog.fetched_at * 1000).toLocaleString() : "неизвестны"}.
                    </p>}
                    <button type="button" className="secondary-button" disabled={imageGenerationBusy} onClick={onRefresh}>Обновить каталог и цену</button>
                    {!imageModels.length && <p>В сохранённом каталоге нет подтверждённых моделей генерации.</p>}
                    <label htmlFor="image-generation-prompt">Описание изображения</label>
                    <textarea id="image-generation-prompt" maxLength={32_000} value={imagePrompt} disabled={imageGenerationBusy}
                              onChange={(event) => setImagePrompt(event.target.value)} placeholder="Опишите изображение"/>
                    <button type="button" disabled={imageGenerationBusy || imageSaving || !imagePrompt.trim() || uncertainImageSignatures.has(JSON.stringify([selectedImageModel?.id || "", imagePrompt.trim()])) || !imageModels.some((model) => model.id === (imageModelId || imageModels[0]?.id) && model.request_rubles !== null)}
                            onClick={() => void generateImage()}>{imageGenerationBusy ? "Запрос выполняется…" : "Проверить цену и сгенерировать"}</button>
                    {uncertainImageSignatures.has(JSON.stringify([selectedImageModel?.id || "", imagePrompt.trim()])) && <p role="alert">Результат предыдущего запроса неизвестен; повтор этого же запроса заблокирован.</p>}
                    {generatedImage && <div className="generated-image-result">
                        <img src={generatedImage.data_url} alt={`Результат ${generatedImage.model_id}`}/>
                        <p>{generatedImage.model_id} · {generatedImage.price_rubles} ₽ за успешный запрос</p>
                        <button type="button" className="secondary-button" disabled={imageSaving} onClick={() => void saveGeneratedImage()}>
                            {imageSaving ? "Сохранение…" : imageSaved ? "Файл сохранён" : "Сохранить PNG…"}
                        </button>
                    </div>}
                </div></div>
    </section>;
}
