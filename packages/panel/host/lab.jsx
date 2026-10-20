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

function eveLabSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value.seconds !== undefined) return value.seconds;
  return null;
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

/* Timecode in the sequence frame rate, non-drop. QE razor may want ";" instead of ":" on drop-frame
 * sequences; the probe reports the error so José can tell. */
function eveLabTimecode(seconds, sequence) {
  var ticksPerFrame = Number(sequence.timebase);
  var fps = ticksPerFrame > 0 ? EVE_LAB_TICKS_PER_SECOND / ticksPerFrame : 25;
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
    } else if (eveLabItemPath(child) === path) {
      return child;
    }
  }
  return null;
}

function eveLabFindSequenceByName(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var child = parent.children[i];
    if (child.type === ProjectItemType.BIN) {
      var nested = eveLabFindSequenceByName(child, name);
      if (nested) return nested;
    } else if (child.name === name && typeof child.openInTimeline === 'function') {
      return child;
    }
  }
  return null;
}

/* P1: export the captions by script.
 * (a) exportAsMediaDirect with the sidecar .epr; (b) exportAsFinalCutProXML and look for caption text. */
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

    if (arg.eprPath && arg.outPath) {
      var directStart = eveLabNow();
      var directOk = seq.exportAsMediaDirect(arg.outPath, arg.eprPath, 0);
      data.direct = {
        ok: directOk,
        durationMs: eveLabNow() - directStart,
        fileExists: new File(arg.outPath).exists,
        fileSize: eveLabFileSize(arg.outPath),
        path: arg.outPath
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
    var item = eveLabFindItemByPath(bin, arg.srtPath);

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

/* P6A: clone the sequence, razor 20 points with QE and remove every other piece. Works on the clone. */
function eveLabP6A(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    var cuts = arg.cuts ? Number(arg.cuts) : 20;
    var spacing = arg.spacingSeconds ? Number(arg.spacingSeconds) : 1.5;
    var base = arg.startSeconds !== undefined && arg.startSeconds !== null ? Number(arg.startSeconds) : 1;

    var cloneCreated = seq.clone();
    var cloneName = seq.name + ' Copy';
    var cloneItem = eveLabFindSequenceByName(app.project.rootItem, cloneName);
    if (!cloneItem) throw new Error('clone() não criou a sequência "' + cloneName + '"');

    cloneItem.name = seq.name + ' (lab P6)';
    cloneItem.openInTimeline();
    var target = app.project.activeSequence;

    var videosBefore = target.videoTracks[0].clips.numItems;
    var audioBefore = target.audioTracks.numTracks > 0 ? target.audioTracks[0].clips.numItems : null;

    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var errors = [];
    var razors = 0;

    // From the end to the start, so a cut never moves the next cut point.
    for (var i = cuts - 1; i >= 0; i--) {
      var timecode = eveLabTimecode(base + i * spacing, target);
      try {
        qeSeq.getVideoTrackAt(0).razor(timecode);
        razors++;
      } catch (e1) {
        errors.push('razor V1 em ' + timecode + ': ' + String(e1));
      }
      try {
        qeSeq.getAudioTrackAt(0).razor(timecode);
      } catch (e2) {
        errors.push('razor A1 em ' + timecode + ': ' + String(e2));
      }
    }

    var removed = 0;
    var videoClips = target.videoTracks[0].clips;
    var videoCount = videoClips.numItems;
    for (var v = videoCount - 2; v >= 1; v -= 2) {
      try {
        videoClips[v].remove(true, true);
        removed++;
      } catch (e3) {
        errors.push('remove V1 índice ' + v + ': ' + String(e3));
      }
    }

    if (target.audioTracks.numTracks > 0) {
      var audioClips = target.audioTracks[0].clips;
      var audioCount = audioClips.numItems;
      for (var a = audioCount - 2; a >= 1; a -= 2) {
        try {
          audioClips[a].remove(true, true);
        } catch (e4) {
          errors.push('remove A1 índice ' + a + ': ' + String(e4));
        }
      }
    }

    return eveLabOk({
      originalSequence: seq.name,
      cloneCreated: cloneCreated,
      cloneSequence: target ? target.name : null,
      timebase: String(target.timebase),
      cuts: cuts,
      razors: razors,
      removed: removed,
      videosBefore: videosBefore,
      audioBefore: audioBefore,
      videoClipsAfter: target.videoTracks[0].clips.numItems,
      notes: 'A sequência original não foi tocada; o corte ficou na cópia.',
      errors: errors
    });
  } catch (e) {
    return eveLabErr(e);
  }
}

/* P6B: export FCP XML and import it back unchanged. The edited-XML cut is only needed if P6A fails. */
function eveLabP6B(argJson) {
  try {
    var arg = eveLabArgs(argJson);
    var seq = eveLabSequence();
    if (!arg.xmlPath) throw new Error('Informe o caminho do .xml.');

    var started = eveLabNow();
    var exportOk = seq.exportAsFinalCutProXML(arg.xmlPath);
    var durationMs = eveLabNow() - started;

    var bin = eveLabFindOrCreateBin(eveLabBaseBin(), 'Lab P6');
    app.project.importFiles([arg.xmlPath], true, bin, false);
    var item = eveLabFindItemByPath(bin, arg.xmlPath);

    return eveLabOk({
      sequence: seq.name,
      exportOk: exportOk,
      durationMs: durationMs,
      fileSize: eveLabFileSize(arg.xmlPath),
      importedItem: item ? { name: item.name, type: item.type, canOpenInTimeline: typeof item.openInTimeline } : null,
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
    var item = eveLabFindItemByPath(bin, arg.stylePath);

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
