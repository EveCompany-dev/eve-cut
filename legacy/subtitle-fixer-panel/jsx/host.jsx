/* host.jsx - the only thing the panel asks Premiere to do: import the corrected
 * .srt into the project panel. Returns "ok" or an error string. */

function importSubtitle(filePath) {
    try {
        if (!app || !app.project) return "nenhum projeto aberto";

        var f = new File(filePath);
        if (!f.exists) return "arquivo não encontrado";

        var bin = app.project.rootItem;

        // Drop it in a "Legendas Corrigidas" bin so it doesn't clutter the root.
        var binName = "Legendas Corrigidas";
        var target = null;
        for (var i = 0; i < bin.children.numItems; i++) {
            var child = bin.children[i];
            if (child.type === ProjectItemType.BIN && child.name === binName) {
                target = child;
                break;
            }
        }
        if (!target) target = bin.createBin(binName);

        app.project.importFiles([filePath], true /* suppressUI */, target, false /* not numbered stills */);
        return "ok";
    } catch (e) {
        return String(e);
    }
}
