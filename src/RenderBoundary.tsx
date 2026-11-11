import {Component, type ReactNode} from "react";
import {OperationNotice, safeDiagnostic, type OperationError, notify} from "./OperationErrors";

export default class RenderBoundary extends Component<{children: ReactNode; sourceText?: string}, {error: OperationError | null; raw: boolean}> {
    state: {error: OperationError | null; raw: boolean} = {error: null, raw: false};
    static getDerivedStateFromError(reason: unknown) {
        const diagnostic = safeDiagnostic("Отображение", reason);
        return {error: {...diagnostic, id: "render", area: "send", conversation: null,
            message: "Не удалось показать содержимое. Сохранённые данные не удалены."}, raw: false};
    }
    componentDidCatch() {
        notify("Не удалось показать содержимое. Доступно восстановление на месте ошибки.", this.props.sourceText === undefined ? "render:screen" : "render:answer", Infinity);
    }
    render() {
        if (!this.state.error) return this.props.children;
        const answer = this.props.sourceText !== undefined;
        return <section className="render-error" aria-label={answer ? "Сбой отображения ответа" : "Сбой рабочего экрана"}>
            <h2>{answer ? "Не удалось показать ответ" : "Не удалось открыть рабочую область"}</h2>
            <OperationNotice error={this.state.error}/>
            {answer ? <><button type="button" onClick={() => this.setState({raw: true})}>Показать исходный текст</button>
                {this.state.raw && <pre>{this.props.sourceText}</pre>}</> :
                <button type="button" onClick={() => this.setState({error: null, raw: false})}>Открыть заново</button>}
        </section>;
    }
}
