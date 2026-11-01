import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { toParent } from "./protocol";
import { EditorController } from "./controller";
import { verifiedParentOrigin } from "./protocol";
import { useStore } from "../components/StoreContext";

/**
 * Active only for a draft preview that (a) asked for the editor (`editor=1`), (b) is framed by, and (c) whose parent origin is on
 * the allow-list. Anywhere else it renders nothing and registers nothing, so the public storefront carries no editing code paths.
 */
export default function EditorBridge() {
  const { editor, preview } = useStore();
  const queryClient = useQueryClient();
  const location = useLocation();
  const origin = editor && preview ? verifiedParentOrigin() : null;

  useEffect(() => {
    if (!origin || !preview) return;
    const controller = new EditorController(document, window, window.parent, origin, preview);
    controller.onRefresh = () => void queryClient.invalidateQueries();
    (window as unknown as { __novaEditor?: EditorController }).__novaEditor = controller;
    return () => {
      controller.dispose();
      delete (window as unknown as { __novaEditor?: EditorController }).__novaEditor;
    };
  }, [origin, preview, queryClient]);

  useEffect(() => {
    if (!origin || !preview) return;
    window.parent.postMessage(toParent({ type: "location", versionId: preview, path: location.pathname }), origin);
  }, [origin, preview, location.pathname]);

  return null;
}
