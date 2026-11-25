import {useEffect, useRef, useState, type Dispatch, type SetStateAction} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import type {ModelCatalog} from "../../modelCatalog";

type TranscriptionResult = { text: string };
type Options = {
    catalog: ModelCatalog | null;
    setCatalog: Dispatch<SetStateAction<ModelCatalog | null>>;
    clear: (operation: string) => void;
    report: (operation: string, reason: unknown) => void;
};

export function useVoiceInput({catalog, setCatalog, clear, report}: Options) {
    const [closeVoiceConfirm, setCloseVoiceConfirm] = useState(false);
    const [replaceVoiceConfirm, setReplaceVoiceConfirm] = useState(false);
    const [transcriptionConfirm, setTranscriptionConfirm] = useState(false);
    const [voiceOpen, setVoiceOpen] = useState(false);
    const [voicePreparation, setVoicePreparation] = useState<"microphone" | "audio" | null>(null);
    const voicePreparing = voicePreparation !== null;
    const permissionRequest = useRef(0);
    const voicePending = useRef(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const cancelRecording = useRef(false);
    const [recording, setRecording] = useState(false);
    const [recordedAudio, setRecordedAudio] = useState<{id: string; base64: string; mime: string; seconds: number} | null>(null);
    const [transcriptionText, setTranscriptionText] = useState("");
    const [transcriptionAvailable, setTranscriptionAvailable] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [uncertainTranscription, setUncertainTranscription] = useState("");
    const [transcriptionModelId, setTranscriptionModelId] = useState("");
    const recorder = useRef<MediaRecorder | null>(null);
    const recordingStream = useRef<MediaStream | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const audioSize = useRef(0);
    const transcriptionModels = catalog?.models.filter((model) => model.protocols.includes("audio_transcriptions") && model.audio_rubles_per_minute !== null) ?? [];
    const selectedTranscriptionModel = transcriptionModels.find((model) => model.id === transcriptionModelId) ?? transcriptionModels[0];
    async function startVoiceRecording(replace = false) {
        if (voicePending.current || transcribing) return;
        if (!replace && (recordedAudio || transcriptionText)) { setReplaceVoiceConfirm(true); return; }
        voicePending.current = true;
        const request = ++permissionRequest.current;
        clear("startVoiceRecording");
        setVoicePreparation("microphone");
        try {
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new DOMException("", "NotSupportedError");
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            if (request !== permissionRequest.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            recordingStream.current = stream;
            audioChunks.current = [];
            audioSize.current = 0;
            cancelRecording.current = false;
            const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? {mimeType: "audio/webm;codecs=opus"} : {};
            const nextRecorder = new MediaRecorder(stream, options);
            recorder.current = nextRecorder;
            nextRecorder.ondataavailable = (event) => {
                if (!event.data.size) return;
                audioSize.current += event.data.size;
                if (audioSize.current <= 25 * 1024 * 1024) audioChunks.current.push(event.data);
                else {
                    report("startVoiceRecording", "Запись превысила 25 МиБ и удалена. Попробуйте короче.");
                    if (nextRecorder.state === "recording") nextRecorder.stop();
                }
            };
            nextRecorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                recordingStream.current = null;
                setRecording(false);
                setVoicePreparation("audio");
                if (cancelRecording.current) { audioChunks.current = []; voicePending.current = false; setVoicePreparation(null); return; }
                if (audioSize.current > 25 * 1024 * 1024) { setRecordedAudio(null); voicePending.current = false; setVoicePreparation(null); return; }
                const seconds = Math.min(600, (Date.now() - startedAt.current) / 1000);
                void new Blob(audioChunks.current, {type: nextRecorder.mimeType}).arrayBuffer().then((buffer) => {
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                    setRecordedAudio({id: crypto.randomUUID(), base64: btoa(binary), mime: nextRecorder.mimeType.split(";")[0] || "audio/webm", seconds});
                }).catch(() => report("startVoiceRecording", "Не удалось подготовить запись."))
                    .finally(() => { voicePending.current = false; setVoicePreparation(null); });
            };
            startedAt.current = Date.now();
            nextRecorder.start(1000);
            setRecordedAudio(null);
            setTranscriptionText("");
            setTranscriptionAvailable(false);
            setRecording(true);
            setVoicePreparation(null);
            window.setTimeout(() => { if (recorder.current === nextRecorder && nextRecorder.state === "recording") nextRecorder.stop(); }, 600_000);
        } catch (reason) {
            if (request !== permissionRequest.current) return;
            voicePending.current = false;
            setVoicePreparation(null);
            recordingStream.current?.getTracks().forEach((track) => track.stop());
            recordingStream.current = null;
            report("startVoiceRecording", reason);
        }
    }

    const voiceAtRisk = useRef(false);
    voiceAtRisk.current = recording || voicePreparing || !!recordedAudio || !!transcriptionText || transcribing;
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void getCurrentWindow().onCloseRequested((event) => {
            if (voiceAtRisk.current || voicePending.current) { event.preventDefault(); setCloseVoiceConfirm(true); }
        }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
        return () => { disposed = true; unlisten?.(); };
    }, []);

    const startedAt = useRef(0);

    useEffect(() => {
        if (!recording) return;
        setRecordingSeconds(0);
        const timer = window.setInterval(() => setRecordingSeconds(Math.min(600, Math.floor((Date.now() - startedAt.current) / 1000))), 1000);
        return () => window.clearInterval(timer);
    }, [recording]);

    useEffect(() => () => {
        permissionRequest.current++;
        if (recorder.current?.state === "recording") recorder.current.stop();
        recordingStream.current?.getTracks().forEach((track) => track.stop());
    }, []);

    function stopVoiceRecording() {
        if (recorder.current?.state === "recording") recorder.current.stop();
    }

    async function transcribeVoice(confirmed = false) {
        if (!recordedAudio || voicePending.current || transcribing) return;
        const model = selectedTranscriptionModel;
        if (!model || model.audio_rubles_per_minute === null || !model.protocols.includes("audio_transcriptions")) return;
        const signature = recordedAudio.id;
        if (uncertainTranscription === signature) return;
        if (!confirmed) { setTranscriptionConfirm(true); return; }
        setTranscribing(true);
        clear("transcribeVoice");
        try {
            const result = await invoke<TranscriptionResult>("transcribe_audio", {
                modelId: model.id, audioBase64: recordedAudio.base64, mimeType: recordedAudio.mime,
                durationSeconds: recordedAudio.seconds, expectedRatePerMinute: model.audio_rubles_per_minute
            });
            setTranscriptionText(result.text);
            setTranscriptionAvailable(true);
            setRecordedAudio(null);
        } catch (reason) {
            const message = String(reason);
            if (message.includes("UNKNOWN") || /TRANSCRIPTION_HTTP_5\d\d/.test(message)) {
                setUncertainTranscription(signature);
                report("transcribeVoice", "Результат распознавания неизвестен; запрос мог быть принят и оплачен. Автоповтора нет.");
            } else if (message.includes("Ставка изменилась")) {
                try { setCatalog(await invoke<ModelCatalog>("refresh_models")); report("transcribeVoice", "Тариф изменился. Обновите оценку и подтвердите отправку снова."); }
                catch (refreshReason) { report("transcribeVoice", `Не удалось обновить тариф: ${String(refreshReason)}`); }
            } else report("transcribeVoice", message);
        } finally { setTranscribing(false); }
    }

    function cancelVoicePermission() {
        permissionRequest.current++;
        voicePending.current = false;
        setVoicePreparation(null);
    }

    function cancelVoiceRecording() {
        cancelRecording.current = true;
        stopVoiceRecording();
    }

    return {voiceOpen, setVoiceOpen, voicePreparation, voicePreparing, recordingSeconds, recording, recordedAudio, setRecordedAudio,
        transcriptionText, setTranscriptionText, transcriptionAvailable, setTranscriptionAvailable, transcribing, uncertainTranscription,
        transcriptionModels, selectedTranscriptionModel, setTranscriptionModelId, closeVoiceConfirm, setCloseVoiceConfirm,
        replaceVoiceConfirm, setReplaceVoiceConfirm, transcriptionConfirm, setTranscriptionConfirm, startVoiceRecording,
        stopVoiceRecording, cancelVoiceRecording, cancelVoicePermission, transcribeVoice};
}
