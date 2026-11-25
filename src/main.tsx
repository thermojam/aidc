import {createRoot} from "react-dom/client";
import App from "./App";
import {OperationToaster} from "./OperationErrors";
import RenderBoundary from "./RenderBoundary";
import "./style.css";

createRoot(document.getElementById("root")!).render(<><OperationToaster/><RenderBoundary><App/></RenderBoundary></>);
