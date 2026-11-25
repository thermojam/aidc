export type CatalogModel = {
    id: string;
    name: string;
    input_rubles_per_million: number | null;
    output_rubles_per_million: number | null;
    protocols: string[];
    request_rubles: number | null;
    audio_rubles_per_minute: number | null
};
export type ModelCatalog = { fetched_at: number; models: CatalogModel[] };
