/* Lab probes of F0-05 (see docs/PROVAS.md).
 *
 * ES3 only, like index.jsx: every function takes one JSON string and returns
 * {"ok":true,"data":...} or {"ok":false,"error":"..."}. The probes are exploratory on purpose:
 * when an API does not exist they return the error instead of hiding it.
 */

var EVE_LAB_TICKS_PER_SECOND = 254016000000.0;

function eveLabOk(data) {
  return JSON.stringify({ ok: true, data: data });
}

function eveLabErr(e) {
  return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
}

function eveLabArgs(argJson) {
  if (!argJson) return {};
  try {
    return JSON.parse(argJson);
  } catch (e) {
    return {};
  }
}

function eveLabSequence() {
  if (!app.project) throw new Error('Abra um projeto no Premiere.');
  var seq = app.project.activeSequence;
  if (!seq) throw new Error('Abra uma sequência no Premiere.');
  return seq;
}

function eveLabNow() {
  return new Date().getTime();
}

/* Time objects, plain seconds, or tick strings (sequence.end and zeroPoint come as ticks). */
function eveLabSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return /^-?\d+$/.test(value) ? Number(value) / EVE_LAB_TICKS_PER_SECOND : null;
  if (value.seconds !== undefined) return value.seconds;
  return null;
}

/* Premiere hands back Windows paths; the Lab fields may use "/" or another casing. */
function eveLabSamePath(a, b) {
  if (!a || !b) return false;
  return new File(a).fsName.toLowerCase() === new File(b).fsName.toLowerCase();
}

function eveLabFileSize(path) {
  var file = new File(path);
  return file.exists ? file.length : -1;
}

function eveLabReadText(path, maxChars) {
  var file = new File(path);
  if (!file.exists) return null;
  file.encoding = 'UTF-8';
  if (!file.open('r')) return null;
  var text = file.read(maxChars || 200000);
  file.close();
  return text;
}

function eveLabPad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function eveLabFrameSeconds(sequence) {
  var ticksPerFrame = Number(sequence.timebase);
  return ticksPerFrame > 0 ? ticksPerFrame / EVE_LAB_TICKS_PER_SECOND : 1 / 25;
}

function eveLabSnap(seconds, frameSeconds) {
  return Math.round(seconds / frameSeconds) * frameSeconds;
}

/* Timecode as the timeline shows it, start offset (zeroPoint) included: that is what QE razor reads.
 * Time.getFormatted knows drop-frame; the manual fallback only covers non-drop rates. */
function eveLabTimecode(seconds, sequence) {
  var absolute = (eveLabSeconds(sequence.zeroPoint) || 0) + seconds;
  try {
    var settings = sequence.getSettings();
    var time = new Time();
    time.seconds = absolute;
    return time.getFormatted(settings.videoFrameRate, settings.videoDisplayFormat);
  } catch (e) {
    return eveLabManualTimecode(absolute, sequence);
  }
}

function eveLabManualTimecode(seconds, sequence) {
  var fps = 1 / eveLabFrameSeconds(sequence);
  var framesPerSecond = Math.round(fps);
  var totalFrames = Math.round(seconds * fps);
  var frames = totalFrames % framesPerSecond;
  var totalSeconds = Math.floor(totalFrames / framesPerSecond);
  var secs = totalSeconds % 60;
  var mins = Math.floor(totalSeconds / 60) % 60;
  var hours = Math.floor(totalSeconds / 3600);
  return eveLabPad2(hours) + ':' + eveLabPad2(mins) + ':' + eveLabPad2(secs) + ':' + eveLabPad2(frames);
}

function eveLabFindChildBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var child = parent.children[i];
    if (child.type === ProjectItemType.BIN && child.name === name) return child;
  }
  return null;
}

function eveLabFindOrCreateBin(parent, name) {
  var bin = eveLabFindChildBin(parent, name);
  if (bin) return bin;
  return parent.createBin(name);
}

function eveLabBaseBin() {
  return eveLabFindOrCreateBin(app.project.rootItem, 'eve-cut');
}

function eveLabItemPath(item) {
  try {
    return item.getMediaPath();
  } catch (e) {
    return null;
  }
}

function eveLabFindItemByPath(parent, path) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var child = parent.children[i];
    if (child.type === ProjectItemType.BIN) {
      var nested = eveLabFindItemByPath(child, path);
      if (nested) return nested;
    } else if (eveLabSamePath(eveLabItemPath(child), path)) {
      return child;
    }
  }
  return null;
}

/* The item importFiles just added to `bin`: by media path, else the newest one with the file name. */
function eveLabFindImported(bin, path) {
  var byPath = eveLabFindItemByPath(bin, path);
  if (byPath) return byPath;
  var name = new File(path).displayName;
  for (var i = bin.children.numItems - 1; i >= 0; i--) {
    if (bin.children[i].name === name) return bin.children[i];
  }
  return null;
}

function eveLabSequenceIds() {
  var ids = {};
  for (var i = 0; i < app.project.sequences.numSequences; i++) {
    ids[app.project.sequences[i].sequenceID] = true;
  }
  return ids;
}

/* Sequences that appeared since `before` (from eveLabSequenceIds): clones and imported XMLs. */
function eveLabNewSequences(before) {
  var found = [];
  for (var i = 0; i < app.project.sequences.numSequences; i++) {
    var sequence = app.project.sequences[i];
    if (!before[sequence.sequenceID]) found.push(sequence);
  }
  return found;
}

/* .srt files written next to the media since the export started. The sidecar name may carry a
 * suffix (language, track), so match by folder and time instead of the exact name. */
function eveLabSidecarSrts(mediaPath, sinceMs) {
  var folder = new File(mediaPath).parent;
  var files = folder ? folder.getFiles('*.srt') : [];
  var found = [];
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (!(file instanceof File) || file.modified.getTime() < sinceMs - 2000) continue;
    var head = eveLabReadText(file.fsName, 400);
    found.push({
      path: file.fsName,
      size: file.length,
      looksLikeSrt: head !== null && /^﻿?\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(head),
      head: head
    });
  }
  return found;
}

/* P1: export the captions by script.
 * (a) exportAsMediaDirect renders the media (WAV) with the sidecar .epr; the question is whether a
 *     real .srt shows up next to it. The media file existing proves nothing about captions.
 * (b) exportAsFinalCutProXML and look for caption text. */
function eveLabP1(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    var data = {
      sequence: seq.name,
      premiere: app.version,
      presetExists: arg.eprPath ? new File(arg.eprPath).exists : null,
      direct: null,
      xml: null
    };

    if (arg.eprPath && arg.mediaPath) {
      if (/\.srt$/i.test(arg.mediaPath)) {
        throw new Error('A saída é o arquivo de áudio (.wav); o .srt tem que aparecer sozinho ao lado dele.');
      }
      var directStart = eveLabNow();
      var directOk = seq.exportAsMediaDirect(arg.mediaPath, arg.eprPath, 0);
      var sidecars = eveLabSidecarSrts(arg.mediaPath, directStart);
      var srtFound = false;
      for (var s = 0; s < sidecars.length; s++) {
        if (sidecars[s].looksLikeSrt) srtFound = true;
      }
      data.direct = {
        ok: directOk,
        durationMs: eveLabNow() - directStart,
        mediaPath: arg.mediaPath,
        mediaExists: new File(arg.mediaPath).exists,
        mediaSize: eveLabFileSize(arg.mediaPath),
        srtFound: srtFound,
        sidecars: sidecars
      };
    }

    if (arg.xmlPath) {
      var xmlStart = eveLabNow();
      var xmlOk = seq.exportAsFinalCutProXML(arg.xmlPath);
      var text = eveLabReadText(arg.xmlPath, 400000);
      data.xml = {
        ok: xmlOk,
        durationMs: eveLabNow() - xmlStart,
        fileExists: new File(arg.xmlPath).exists,
        fileSize: eveLabFileSize(arg.xmlPath),
        mentionsCaption: text === null ? null : /caption/i.test(text),
        hasTextElements: text === null ? null : /<Text>/i.test(text),
        preview: text === null ? null : text.substring(0, 700)
      };
    }

    return eveLabOk(data);
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P2: import the .srt and create the caption track, at 0 or at the sequence zero point. */
function eveLabP2(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.srtPath) throw new Error('Informe o caminho do .srt.');

    var zeroSeconds = seq.zeroPoint ? Number(seq.zeroPoint) / EVE_LAB_TICKS_PER_SECOND : 0;
    var startAt = 0;
    if (arg.startMode === 'zeroPoint') startAt = zeroSeconds;
    if (arg.startMode === 'custom') startAt = Number(arg.startSeconds) || 0;

    var bin = eveLabFindOrCreateBin(eveLabFindOrCreateBin(app.project.rootItem, 'eve-cut'), 'Legendas');
    app.project.importFiles([arg.srtPath], true, bin, false);
    var item = eveLabFindImported(bin, arg.srtPath);

    var tracksBefore = null;
    try {
      tracksBefore = seq.captionTracks ? seq.captionTracks.numTracks : null;
    } catch (e1) {
      tracksBefore = 'erro: ' + String(e1);
    }

    var created = false;
    var createError = null;
    if (!item) {
      createError = 'o Premiere não devolveu o item importado';
    } else {
      try {
        created = seq.createCaptionTrack(item, startAt, Sequence.CAPTION_FORMAT_SUBTITLE);
      } catch (e2) {
        createError = String(e2);
      }
    }

    var tracksAfter = null;
    try {
      tracksAfter = seq.captionTracks ? seq.captionTracks.numTracks : null;
    } catch (e3) {
      tracksAfter = 'erro: ' + String(e3);
    }

    return eveLabOk({
      sequence: seq.name,
      srtPath: arg.srtPath,
      importedItem: item ? { name: item.name, type: item.type, mediaPath: eveLabItemPath(item) } : null,
      zeroPointTicks: seq.zeroPoint ? String(seq.zeroPoint) : null,
      zeroPointSeconds: zeroSeconds,
      startMode: arg.startMode || 'zero',
      startAt: startAt,
      created: created,
      createError: createError,
      captionTracksBefore: tracksBefore,
      captionTracksAfter: tracksAfter
    });
  } catch (e) {
    return eveLabErr(e);
  }
}

/* Property and method names of an ExtendScript object that match `pattern`, plus the totals. */
function eveLabReflect(obj, pattern) {
  var out = { properties: [], methods: [], totalProperties: 0, totalMethods: 0 };
  if (!obj) return { error: 'objeto vazio' };
  try {
    var props = obj.reflect.properties;
    out.totalProperties = props.length;
    for (var i = 0; i < props.length; i++) {
      var name = String(props[i].name);
      if (pattern.test(name)) {
        var value;
        try {
          value = obj[name];
          value = value === null || value === undefined ? String(value) : typeof value === 'object' ? 'objeto' : String(value);
        } catch (e1) {
          value = 'erro: ' + String(e1);
        }
        out.properties.push(name + ' = ' + value);
      }
    }
  } catch (e2) {
    out.propertiesError = String(e2);
  }
  try {
    var methods = obj.reflect.methods;
    out.totalMethods = methods.length;
    for (var m = 0; m < methods.length; m++) {
      if (pattern.test(String(methods[m].name))) out.methods.push(String(methods[m].name));
    }
  } catch (e3) {
    out.methodsError = String(e3);
  }
  return out;
}

/* P3: is there any way to read the text of captions already in the sequence? (expected: no) */
function eveLabP3() {
  try {
    var seq = eveLabSequence();
    var data = {
      sequence: seq.name,
      videoTracks: seq.videoTracks.numTracks,
      audioTracks: seq.audioTracks.numTracks,
      captionTrackCount: null,
      captionTracks: [],
      probes: []
    };

    try {
      if (!seq.captionTracks) {
        data.captionTrackCount = 'sequence.captionTracks não existe';
      } else {
        data.captionTrackCount = seq.captionTracks.numTracks;
        for (var t = 0; t < seq.captionTracks.numTracks; t++) {
          var track = seq.captionTracks[t];
          var entry = { index: t, name: null, clips: null };
          try {
            entry.name = track.name;
          } catch (e1) {
            entry.name = 'erro: ' + String(e1);
          }
          try {
            entry.clips = track.clips.numItems;
          } catch (e2) {
            entry.clips = 'erro: ' + String(e2);
          }
          data.captionTracks.push(entry);
        }
      }
    } catch (e3) {
      data.captionTrackCount = 'erro: ' + String(e3);
    }

    try {
      var captionTrack = seq.captionTracks[0];
      var captionClip = captionTrack.clips[0];
      data.probes.push({ what: 'captionTracks[0].clips[0].name', value: String(captionClip.name) });
      data.probes.push({ what: 'typeof clips[0].getCaption', value: typeof captionClip.getCaption });
      data.probes.push({ what: 'typeof clips[0].text', value: typeof captionClip.text });
      data.probes.push({ what: 'typeof track.getCaptionText', value: typeof captionTrack.getCaptionText });
      data.probes.push({ what: 'typeof sequence.getCaptionText', value: typeof seq.getCaptionText });
    } catch (e4) {
      data.probes.push({ what: 'ler o primeiro clipe de legenda', error: String(e4) });
    }

    // Reflection lists what the objects really expose, documented or not: the only way to find a
    // caption-track count or a caption text API without guessing names.
    var pattern = /caption|subtitle|text|track/i;
    data.reflect = { sequence: eveLabReflect(seq, pattern), qeSequence: null };
    try {
      app.enableQE();
      data.reflect.qeSequence = eveLabReflect(qe.project.getActiveSequence(), pattern);
    } catch (e5) {
      data.reflect.qeSequence = { error: String(e5) };
    }

    return eveLabOk(data);
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P4: markers with duration, name and comment; try color 0..7; read back and optionally delete. */
function eveLabP4(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    var prefix = arg.namePrefix || 'eve-cut · lab';
    var base = arg.seconds !== undefined && arg.seconds !== null ? Number(arg.seconds) : 1;
    var created = [];

    for (var i = 0; i < 8; i++) {
      var marker = seq.markers.createMarker(base + i * 2);
      marker.name = prefix + ' ' + i;
      marker.comments = 'cor ' + i;
      var endSet = false;
      try {
        marker.end = base + i * 2 + 0.6;
        endSet = true;
      } catch (e1) {
        endSet = String(e1);
      }
      var colorSet = false;
      try {
        marker.setColorByIndex(i);
        colorSet = true;
      } catch (e2) {
        colorSet = String(e2);
      }
      created.push({ index: i, name: marker.name, endSet: endSet, colorSet: colorSet });
    }

    var readBack = [];
    var current = seq.markers.getFirstMarker();
    while (current) {
      if (current.name !== undefined && current.name.indexOf(prefix) === 0) {
        readBack.push({
          name: current.name,
          startSeconds: eveLabSeconds(current.start),
          endSeconds: eveLabSeconds(current.end),
          comments: current.comments
        });
      }
      current = seq.markers.getNextMarker(current);
    }

    var removed = 0;
    if (arg.deleteAfter) {
      var next = seq.markers.getFirstMarker();
      while (next) {
        var after = seq.markers.getNextMarker(next);
        if (next.name !== undefined && next.name.indexOf(prefix) === 0) {
          seq.markers.deleteMarker(next);
          removed++;
        }
        next = after;
      }
    }

    return eveLabOk({ sequence: seq.name, prefix: prefix, created: created, readBack: readBack, removed: removed });
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P5: export the sequence audio to WAV and measure the time. */
function eveLabP5(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.eprPath || !arg.outPath) throw new Error('Informe o preset .epr e o caminho do .wav.');

    var started = eveLabNow();
    var ok = seq.exportAsMediaDirect(arg.outPath, arg.eprPath, 0);
    var durationMs = eveLabNow() - started;

    return eveLabOk({
      sequence: seq.name,
      presetExists: new File(arg.eprPath).exists,
      ok: ok,
      durationMs: durationMs,
      fileExists: new File(arg.outPath).exists,
      fileSize: eveLabFileSize(arg.outPath),
      sequenceSeconds: eveLabSeconds(seq.end)
    });
  } catch (e) {
    return eveLabErr(e);
  }
}

function eveLabRazor(qeSeq, timecode, errors) {
  try {
    qeSeq.getVideoTrackAt(0).razor(timecode);
  } catch (e1) {
    errors.push('razor V1 em ' + timecode + ': ' + String(e1));
  }
  try {
    qeSeq.getAudioTrackAt(0).razor(timecode);
  } catch (e2) {
    errors.push('razor A1 em ' + timecode + ': ' + String(e2));
  }
}

/* Remove, with ripple, the piece that starts at `start` and ends at `end`. When the razor did not
 * split there, no piece matches and nothing is removed: the probe reports it instead of guessing. */
function eveLabRemovePiece(track, start, end, frameSeconds, label, errors) {
  var tolerance = frameSeconds / 2;
  for (var i = 0; i < track.clips.numItems; i++) {
    var clip = track.clips[i];
    if (Math.abs(clip.start.seconds - start) <= tolerance && Math.abs(clip.end.seconds - end) <= tolerance) {
      try {
        clip.remove(true, true);
        return 'removido';
      } catch (e) {
        errors.push('remove ' + label + ' em ' + start + ' s: ' + String(e));
        return 'erro';
      }
    }
  }
  return 'pedaço não encontrado';
}

/* P6A: cut N ranges with ripple using QE razor, on a clone of the active sequence.
 * Same algorithm F2 needs: ranges snapped to frames, applied from the end to the start, razor at
 * both edges, then the piece in between removed on V1 and A1. The duration after the probe should
 * be the duration before minus the removed time. */
function eveLabP6A(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var original = eveLabSequence();
    var count = arg.count ? Number(arg.count) : 10;
    var spacing = arg.spacingSeconds ? Number(arg.spacingSeconds) : 2;
    var width = arg.widthSeconds ? Number(arg.widthSeconds) : 0.4;
    var first = arg.startSeconds !== undefined && arg.startSeconds !== null ? Number(arg.startSeconds) : 1;

    var neededSeconds = first + (count - 1) * spacing + width;
    var originalSeconds = eveLabSeconds(original.end);
    if (originalSeconds !== null && originalSeconds < neededSeconds) {
      throw new Error('A sequência tem ' + originalSeconds + ' s; a prova precisa de pelo menos ' + neededSeconds + ' s.');
    }

    var before = eveLabSequenceIds();
    var cloneOk = original.clone();
    var clones = eveLabNewSequences(before);
    if (clones.length !== 1) {
      throw new Error('clone() criou ' + clones.length + ' sequências (esperava 1). Nada foi cortado.');
    }
    var clone = clones[0];
    try {
      clone.name = original.name + ' (lab P6)';
    } catch (eName) {
      // Keeping Premiere's default name is fine for a probe.
    }

    if (typeof app.project.openSequence === 'function') {
      app.project.openSequence(clone.sequenceID);
    } else if (clone.projectItem) {
      clone.projectItem.openInTimeline();
    }
    var target = app.project.activeSequence;
    // QE razors whatever sequence is active: never go on unless it is the clone.
    if (!target || target.sequenceID !== clone.sequenceID) {
      throw new Error('A cópia não ficou ativa na timeline. Nada foi cortado, para não mexer na sequência original.');
    }

    var frameSeconds = eveLabFrameSeconds(target);
    var durationBefore = eveLabSeconds(target.end);
    var removedSeconds = 0;
    var ranges = [];
    var errors = [];

    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();

    // From the end to the start, so a ripple never moves a range that is still to be cut.
    for (var i = count - 1; i >= 0; i--) {
      var start = eveLabSnap(first + i * spacing, frameSeconds);
      var end = eveLabSnap(first + i * spacing + width, frameSeconds);
      var range = {
        start: start,
        end: end,
        startTimecode: eveLabTimecode(start, target),
        endTimecode: eveLabTimecode(end, target),
        video: null,
        audio: null
      };

      eveLabRazor(qeSeq, range.endTimecode, errors);
      eveLabRazor(qeSeq, range.startTimecode, errors);
      range.video = eveLabRemovePiece(target.videoTracks[0], start, end, frameSeconds, 'V1', errors);
      if (target.audioTracks.numTracks > 0) {
        range.audio = eveLabRemovePiece(target.audioTracks[0], start, end, frameSeconds, 'A1', errors);
      }
      if (range.video === 'removido') removedSeconds += end - start;
      ranges.push(range);
    }

    var durationAfter = eveLabSeconds(target.end);
    return eveLabOk({
      originalSequence: original.name,
      cloneSequence: target.name,
      cloneOk: cloneOk,
      zeroPointSeconds: eveLabSeconds(target.zeroPoint),
      frameSeconds: frameSeconds,
      durationBefore: durationBefore,
      durationAfter: durationAfter,
      expectedDurationAfter: durationBefore === null ? null : durationBefore - removedSeconds,
      ranges: ranges,
      errors: errors,
      notes: 'A sequência original não foi tocada; o corte ficou na cópia.'
    });
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P6B: export FCP XML and import it back unchanged. The edited-XML cut is only needed if P6A fails.
 * An imported XML becomes a sequence with no media path, so it is found by diffing the sequences. */
function eveLabP6B(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.xmlPath) throw new Error('Informe o caminho do .xml.');

    var started = eveLabNow();
    var exportOk = seq.exportAsFinalCutProXML(arg.xmlPath);
    var durationMs = eveLabNow() - started;

    var before = eveLabSequenceIds();
    var bin = eveLabFindOrCreateBin(eveLabBaseBin(), 'Lab P6');
    app.project.importFiles([arg.xmlPath], true, bin, false);
    var created = eveLabNewSequences(before);
    var importedSequences = [];
    for (var i = 0; i < created.length; i++) {
      importedSequences.push({ name: created[i].name, seconds: eveLabSeconds(created[i].end) });
    }

    return eveLabOk({
      sequence: seq.name,
      sequenceSeconds: eveLabSeconds(seq.end),
      exportOk: exportOk,
      durationMs: durationMs,
      fileSize: eveLabFileSize(arg.xmlPath),
      importedSequences: importedSequences,
      note: 'XML sem edição: prova só a ida e volta. A técnica B completa exige editar o XML antes de importar.'
    });
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P8: import a MOGRT, inspect its text parameter and try to change text and duration. */
function eveLabP8(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.mogrtPath) throw new Error('Informe o caminho do .mogrt.');

    var seconds = arg.seconds !== undefined && arg.seconds !== null ? Number(arg.seconds) : 1;
    var start = new Time();
    start.seconds = seconds;
    var trackOffset = arg.videoTrackOffset !== undefined ? Number(arg.videoTrackOffset) : 0;

    var item = seq.importMGT(arg.mogrtPath, start.ticks, trackOffset, 0);
    var data = {
      sequence: seq.name,
      imported: item !== null && item !== undefined,
      name: item ? item.name : null,
      startSeconds: item && item.start ? eveLabSeconds(item.start) : null,
      hasComponent: false,
      parameterNames: [],
      textParamRaw: null,
      textChanged: false,
      endSeconds: null,
      error: null
    };

    if (!item) return eveLabOk(data);

    try {
      var component = item.getMGTComponent();
      data.hasComponent = component !== null && component !== undefined;

      if (component && component.properties) {
        for (var i = 0; i < component.properties.numItems; i++) {
          var property = component.properties[i];
          data.parameterNames.push(String(property.displayName));
        }
        var textParam = component.properties.getParamForDisplayName(arg.textParam || 'Source Text');
        if (textParam) {
          data.textParamRaw = textParam.getValue();
          if (arg.text) {
            var parsed = JSON.parse(data.textParamRaw);
            parsed.textEditValue = arg.text;
            textParam.setValue(JSON.stringify(parsed), true);
            data.textChanged = true;
          }
        }
      }

      var end = new Time();
      end.seconds = seconds + (arg.durationSeconds ? Number(arg.durationSeconds) : 2);
      item.end = end;
      data.endSeconds = eveLabSeconds(item.end);
    } catch (e1) {
      data.error = String(e1);
    }

    return eveLabOk(data);
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P9: does importing a .prtextstyle let a script apply it to the caption track? */
function eveLabP9(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.stylePath) throw new Error('Informe o caminho do .prtextstyle.');

    var bin = eveLabFindOrCreateBin(eveLabBaseBin(), 'Estilos');
    app.project.importFiles([arg.stylePath], true, bin, false);
    var item = eveLabFindImported(bin, arg.stylePath);

    var data = {
      sequence: seq.name,
      fileExists: new File(arg.stylePath).exists,
      importedItem: item ? { name: item.name, type: item.type, mediaPath: eveLabItemPath(item) } : null,
      captionTracks: null,
      probes: []
    };

    try {
      data.captionTracks = seq.captionTracks ? seq.captionTracks.numTracks : null;
    } catch (e1) {
      data.captionTracks = 'erro: ' + String(e1);
    }

    try {
      var track = seq.captionTracks[0];
      data.probes.push({ what: 'typeof track.applyStyle', value: typeof track.applyStyle });
      data.probes.push({ what: 'typeof track.setStyle', value: typeof track.setStyle });
      data.probes.push({ what: 'typeof track.style', value: typeof track.style });
      data.probes.push({ what: 'typeof sequence.importTextStyle', value: typeof seq.importTextStyle });
    } catch (e2) {
      data.probes.push({ what: 'faixa de legenda', error: String(e2) });
    }

    return eveLabOk(data);
  } catch (e) {
    return eveLabErr(e);
  }
}
