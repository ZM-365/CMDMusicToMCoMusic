class Converter {
    constructor() {
        this.mcRegex = new RegExp(
            "execute as @[a-zA-Z]\\[scores=\\{[a-zA-Z0-9_]+=(-?\\d+)\\}\\](?: at @s)? run playsound ([a-zA-Z0-9_.]+) @[a-zA-Z] (?:[~^][+-]?\\d*\\.?\\d*)\\s*(?:[~^][+-]?\\d*\\.?\\d*)\\s*(?:[~^][+-]?\\d*\\.?\\d*) [\\d.]+ ([\\d.]+)(?:[\\d.]+)?"
        );
        this.compressedRegex = new RegExp(
            /^execute as @a(?:\[.*?\])? (?:at @s )?unless entity @s\[scores=\{.*?\}\](?: at @s)? run playsound ([a-zA-Z0-9_.]+) @[a-zA-Z] (?:[~^][+-]?\d*\.?\d*)\s*(?:[~^][+-]?\d*\.?\d*)\s*(?:[~^][+-]?\d*\.?\d*) [\d.]+ ([\d.]+)(?: [\d.]+)?$/
        );
        this.scoreExtractRegex = new RegExp(/([a-zA-Z0-9_]+)=!(-?\d+)/g);
    }

    parseMcCommand(line, offset) {
        const match = line.match(this.mcRegex);
        if (match) {
            const rawTick = parseInt(match[1], 10);
            const instrument = match[2];
            const pitch = match[3];
            const finalTick = rawTick + offset;
            return {tick: finalTick, instrument: instrument, pitch: pitch, originalLine: `${finalTick} ${instrument} ${pitch}`};
        }
        return null;
    }

    parseCompressedCommand(line, offset) {
        const match = line.match(this.compressedRegex);
        if (match) {
            const instrument = match[1];
            const pitch = match[2];
            const scoreMatches = line.matchAll(this.scoreExtractRegex);
            const results = [];
            for (const scoreMatch of scoreMatches) {
                const rawTick = parseInt(scoreMatch[2], 10);
                const finalTick = rawTick + offset;
                results.push({tick: finalTick, instrument: instrument, pitch: pitch, originalLine: `${finalTick} ${instrument} ${pitch}`});
            }
            return results.length > 0 ? results : null;
        }
        return null;
    }

    sortResults(resultsArray) {
        return resultsArray.sort((a, b) => {
            if (a.tick !== b.tick) {
                return a.tick - b.tick;
            }
            if (a.instrument !== b.instrument) {
                return a.instrument.localeCompare(b.instrument);
            }
            return parseFloat(a.pitch) - parseFloat(b.pitch);
        });
    }

    mergeIdenticalEntries(resultsArray) {
        const mergedMap = new Map();
        
        for (const result of resultsArray) {
            const key = `${result.tick} ${result.instrument} ${result.pitch}`;
            if (mergedMap.has(key)) {
                const existing = mergedMap.get(key);
                existing.count += 1;
                existing.originalLine = `${existing.tick} ${existing.instrument} ${existing.pitch} ${existing.count}`;
            } else {
                mergedMap.set(key, {
                    ...result,
                    count: 1,
                    originalLine: `${result.tick} ${result.instrument} ${result.pitch}`
                });
            }
        }
        
        return Array.from(mergedMap.values());
    }

    convertLines(text, offset, format = 'normal') {
        const lines = text.split("\n");
        const outResults = [];
        const errorLines = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            if (format === 'normal') {
                const converted = this.parseMcCommand(trimmed, offset);
                if (converted) {
                    outResults.push(converted);
                } else {
                    const compressedResult = this.parseCompressedCommand(trimmed, offset);
                    if (compressedResult) {
                        outResults.push(...compressedResult);
                    } else {
                        errorLines.push("发生错误：" + trimmed);
                    }
                }
            } else if (format === 'compressed') {
                const converted = this.parseCompressedCommand(trimmed, offset);
                if (converted) {
                    outResults.push(...converted);
                } else {
                    const normalResult = this.parseMcCommand(trimmed, offset);
                    if (normalResult) {
                        outResults.push(normalResult);
                    } else {
                        errorLines.push("发生错误：" + trimmed);
                    }
                }
            } else {
                errorLines.push(`错误：未知指令格式 "${format}"`);
            }
        }
        
        const mergedResults = this.mergeIdenticalEntries(outResults);
        const sortedResults = this.sortResults(mergedResults);
        
        const outputLines = [];
        sortedResults.forEach(result => {
            outputLines.push(result.originalLine);
        });
        
        if (errorLines.length > 0) {
            outputLines.push(...errorLines);
        }
        
        return outputLines.join("\n");
    }
}

class Compressor {
    generateVarName(index) {
        if (index < 26) {
            return String.fromCharCode(97 + index);
        }
        else if (index < 702) {
            let i = index - 26;
            const first = Math.floor(i / 26);
            const second = i % 26;
            return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
        }
        else if (index < 18278) {
            let i = index - 702;
            const first = Math.floor(i / 676);
            const second = Math.floor((i % 676) / 26);
            const third = i % 26;
            return String.fromCharCode(97 + first) + String.fromCharCode(97 + second) + String.fromCharCode(97 + third);
        }
        else {
            return "_v" + (index - 18278 + 1);
        }
    }

    compress(text) {
        const lines = text.split("\n");
        const frequency = new Map();

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            frequency.set(trimmed, (frequency.get(trimmed) || 0) + 1);
            
            const parts = trimmed.split(" ");
            if (parts.length >= 3) {
                const instrPitch = parts.slice(1, 3).join(" ");
                frequency.set(instrPitch, (frequency.get(instrPitch) || 0) + 1);
            }
        }

        const sortedPhrases = Array.from(frequency.entries())
            .filter(([phrase, count]) => count > 1 && phrase.length > 3)
            .sort((a, b) => (b[0].length * b[1]) - (a[0].length * a[1]));

        if (sortedPhrases.length === 0) return text;

        const dictionary = [];
        let currentText = text;
        let varIndex = 0;

        for (const [phrase, count] of sortedPhrases) {
            const savings = (phrase.length * count) - ((phrase.length + 6) + (3 * count));
            if (savings > 0) {
                const varName = this.generateVarName(varIndex++);
                dictionary.push(`${varName} = ${phrase}`);
                
                const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|\\s)${escapedPhrase}(?=\\s|$)`, 'g');
                currentText = currentText.replace(regex, `$1$${varName}`);
            }
        }

        if (dictionary.length === 0) {
            return text;
        }

        const compressedResult = dictionary.join("\n") + "\n" + currentText;
        return compressedResult.replace(/\n/g, ';');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();

    const elInputText = document.getElementById("input_text");
    const elOutputText = document.getElementById("output_text");
    const elOffset = document.getElementById("offset_input");
    const elFileInput = document.getElementById("file_input");
    const elFormatSelect = document.getElementById("format_select");
    const elFormatHint = document.getElementById("format_hint");
    
    const btnConvert = document.getElementById("btn_convert");
    const btnCompress = document.getElementById("btn_compress");
    const btnCopy = document.getElementById("btn_copy");
    const btnDownload = document.getElementById("btn_download");

    const elZipInput = document.getElementById("zip_input");
    const elZipFilename = document.getElementById("zip_filename");
    const elBatchOutputFormat = document.getElementById("batch_output_format");
    const btnBatchConvert = document.getElementById("btn_batch_convert");
    const elBatchStatus = document.getElementById("batch_status");

    const converter = new Converter();
    const compressor = new Compressor();

    const formatHints = {
        'normal': '普通指令格式示例: <code class="text-indigo-600">execute as @a[scores={music=123}] at @s run playsound note.harp @s ~~~ 1.0 0.98765 1.0</code>',
        'compressed': '压缩指令格式示例: <code class="text-indigo-600">execute as @a unless entity @s[scores={music=!15,music=!50}] at @s run playsound note.harp @s ~~~ 1.0 0.56789 1.0</code>'
    };

    function setBatchStatus(message, show = true) {
        elBatchStatus.textContent = message;
        if (show) {
            elBatchStatus.classList.remove("hidden");
        } else {
            elBatchStatus.classList.add("hidden");
        }
    }

    function getOutputFileName(originalName, targetFormat) {
        const dotIndex = originalName.lastIndexOf(".");
        const base = dotIndex > -1 ? originalName.slice(0, dotIndex) : originalName;
        const ext = targetFormat === "compressed" ? ".txt" : ".txt";
        return `${base}_${targetFormat}${ext}`;
    }

    function convertSingleContent(text, offset, inputFormat, targetFormat) {
        const converted = converter.convertLines(text, offset, inputFormat);
        if (targetFormat === "compressed") {
            return compressor.compress(converted);
        }
        return converted;
    }

    elFormatSelect.addEventListener('change', (e) => {
        elFormatHint.innerHTML = formatHints[e.target.value] || formatHints['normal'];
    });

    elFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            elInputText.value = evt.target.result;
        };
        reader.readAsText(file);
    });

    elZipInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        elZipFilename.value = file ? file.name : "";
        setBatchStatus("", false);
    });

    btnConvert.addEventListener("click", () => {
        const text = elInputText.value;
        const offset = parseInt(elOffset.value, 10) || 0;
        const format = elFormatSelect.value;
        elOutputText.value = converter.convertLines(text, offset, format);
    });

    btnCompress.addEventListener("click", () => {
        const text = elInputText.value;
        const offset = parseInt(elOffset.value, 10) || 0;
        const format = elFormatSelect.value;
        const converted = converter.convertLines(text, offset, format);
        elOutputText.value = compressor.compress(converted);
    });

    btnCopy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(elOutputText.value);
            const originalHTML = btnCopy.innerHTML;
            btnCopy.innerHTML = `<i data-lucide="check" class="w-3 h-3"></i> 已复制`;
            lucide.createIcons();
            setTimeout(() => {
                btnCopy.innerHTML = originalHTML;
                lucide.createIcons();
            }, 2000);
        } catch (err) {
            alert("复制失败");
        }
    });

    btnDownload.addEventListener("click", () => {
        const text = elOutputText.value;
        if (!text) return;
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "music_converted_sorted.txt";
        a.click();
        URL.revokeObjectURL(url);
    });

    btnBatchConvert.addEventListener("click", async () => {
        const zipFile = elZipInput.files[0];
        if (!zipFile) {
            alert("请先选择一个 zip 压缩包");
            return;
        }

        const offset = parseInt(elOffset.value, 10) || 0;
        const inputFormat = elFormatSelect.value;
        const targetFormat = elBatchOutputFormat.value;

        const originalHTML = btnBatchConvert.innerHTML;
        btnBatchConvert.disabled = true;
        btnBatchConvert.classList.add("opacity-70", "cursor-not-allowed");
        btnBatchConvert.innerHTML = `<i data-lucide="loader-circle" class="w-4 h-4 animate-spin"></i> 处理中...`;
        lucide.createIcons();

        try {
            setBatchStatus("正在读取压缩包...");

            const zipData = await zipFile.arrayBuffer();
            const inputZip = await JSZip.loadAsync(zipData);
            const outputZip = new JSZip();

            const entries = Object.keys(inputZip.files);
            const validFiles = entries.filter(name => {
                const entry = inputZip.files[name];
                if (entry.dir) return false;
                return /\.(txt|mcfunction)$/i.test(name);
            });

            if (validFiles.length === 0) {
                throw new Error("压缩包中没有可处理的 .txt 或 .mcfunction 文件");
            }

            let successCount = 0;
            let failCount = 0;
            const logs = [];

            for (let i = 0; i < validFiles.length; i++) {
                const fileName = validFiles[i];
                setBatchStatus(`正在处理 (${i + 1}/${validFiles.length})：${fileName}`);

                try {
                    const fileText = await inputZip.files[fileName].async("string");
                    const resultText = convertSingleContent(fileText, offset, inputFormat, targetFormat);
                    const outputName = getOutputFileName(fileName, targetFormat);
                    outputZip.file(outputName, resultText);
                    successCount++;
                    logs.push(`成功：${fileName} -> ${outputName}`);
                } catch (fileErr) {
                    failCount++;
                    logs.push(`失败：${fileName} -> ${fileErr.message}`);
                }
            }

            logs.unshift(`处理完成：成功 ${successCount} 个，失败 ${failCount} 个`);

            setBatchStatus(logs.join("\n"));

            const finalBlob = await outputZip.generateAsync({ type: "blob" });
            const zipBaseName = zipFile.name.replace(/\.zip$/i, "");
            const downloadName = `${zipBaseName}_${targetFormat}_converted.zip`;
            saveAs(finalBlob, downloadName);
        } catch (err) {
            setBatchStatus(`批量转换失败：${err.message}`);
            alert(`批量转换失败：${err.message}`);
        } finally {
            btnBatchConvert.disabled = false;
            btnBatchConvert.classList.remove("opacity-70", "cursor-not-allowed");
            btnBatchConvert.innerHTML = originalHTML;
            lucide.createIcons();
        }
    });
});
