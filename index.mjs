import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 可选模型列表
// ============================================================
const AVAILABLE_MODELS = [
    "SmilingWolf/wd-swinv2-tagger-v3",
    "SmilingWolf/wd-convnext-tagger-v3",
    "SmilingWolf/wd-vit-tagger-v3",
    "SmilingWolf/wd-v1-4-moat-tagger-v2",
    "SmilingWolf/wd-v1-4-swinv2-tagger-v2",
    "SmilingWolf/wd-v1-4-convnext-tagger-v2",
    "SmilingWolf/wd-v1-4-convnextv2-tagger-v2",
    "SmilingWolf/wd-v1-4-vit-tagger-v2",
];

const HF_BASE_URL = "https://smilingwolf-wd-tagger.hf.space/gradio_api";

// ============================================================
// 配置管理
// ============================================================
const DEFAULT_CONFIG = {
    model: "SmilingWolf/wd-swinv2-tagger-v3",
    generalThreshold: 0.35,
    characterThreshold: 0.85,
    proxyAgent: "",
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig(ctx) {
    const configFilePath = ctx.configPath;
    try {
        if (fs.existsSync(configFilePath)) {
            const raw = fs.readFileSync(configFilePath, "utf-8");
            const loaded = JSON.parse(raw);
            currentConfig = { ...DEFAULT_CONFIG, ...loaded };
            ctx.logger.info("[WD-Tagger] 配置已加载");
        } else {
            saveConfig(ctx, DEFAULT_CONFIG);
        }
    } catch (e) {
        ctx.logger.error("[WD-Tagger] 加载配置失败", e);
    }
}

function saveConfig(ctx, newConfig) {
    const configFilePath = ctx.configPath;
    try {
        currentConfig = { ...currentConfig, ...newConfig };
        const dir = path.dirname(configFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2), "utf-8");
        ctx.logger.info("[WD-Tagger] 配置已保存");
    } catch (e) {
        ctx.logger.error("[WD-Tagger] 保存配置失败", e);
    }
}

// ============================================================
// 配置 UI
// ============================================================
function buildConfigUI(ctx) {
    const { NapCatConfig } = ctx;
    return NapCatConfig.combine(
        NapCatConfig.html('<div style="padding:10px; border-bottom:1px solid #ccc;"><h3>AI Tagger 图片识别插件</h3><br>原作者：ntrwansui<br>发送 "rec" 并附带图片（或引用图片消息），即可反推 AI 绘画标签、角色和安全评级。<br>API: <a href="https://smilingwolf-wd-tagger.hf.space/">HuggingFace WD Tagger</a></div>'),
        NapCatConfig.text("model", "模型", DEFAULT_CONFIG.model, "WD Tagger 模型名称"),
        NapCatConfig.text("generalThreshold", "通用标签阈值", String(DEFAULT_CONFIG.generalThreshold), "0~1 之间，越低标签越多（默认 0.35）"),
        NapCatConfig.text("characterThreshold", "角色标签阈值", String(DEFAULT_CONFIG.characterThreshold), "0~1 之间（默认 0.85）"),
        NapCatConfig.text("proxyAgent", "代理地址", DEFAULT_CONFIG.proxyAgent, "可选，用于访问 HuggingFace（如 http://127.0.0.1:7890）")
    );
}

// ============================================================
// OB11 调用辅助
// ============================================================
async function callOB11(ctx, action, params) {
    try {
        return await ctx.actions.call(action, params, ctx.adapterName, ctx.pluginManager.config);
    } catch (e) {
        ctx.logger.error(`[WD-Tagger] Call OB11 ${action} failed:`, e);
    }
}

function textSegment(text) {
    return { type: 'text', data: { text } };
}

async function sendGroupMsg(ctx, groupId, message) {
    return callOB11(ctx, 'send_msg', {
        message_type: 'group',
        group_id: String(groupId),
        message: typeof message === 'string' ? [textSegment(message)] : message,
    });
}

// ============================================================
// 从消息中提取图片 URL
// ============================================================
function extractImageUrl(rawMessage) {
    // 匹配 CQ 码中的图片: [CQ:image,file=xxx,url=xxx]
    const cqMatch = rawMessage.match(/\[CQ:image,[^\]]*url=([^\],\]]+)/);
    if (cqMatch) return cqMatch[1];

    // 匹配 [CQ:image,file=xxx] (有些情况 url 字段名不同)
    const fileMatch = rawMessage.match(/\[CQ:image,file=([^\],\]]+)/);
    if (fileMatch) return fileMatch[1];

    return null;
}

// ============================================================
// 构建 fetch 选项（可选代理）
// ============================================================
function buildFetchOptions(extraOptions = {}) {
    const options = { ...extraOptions };
    // Node.js 原生 fetch 不直接支持 proxyAgent，
    // 若需代理需使用 undici 等库。此处预留配置项。
    return options;
}

// ============================================================
// HuggingFace Gradio API 交互
// ============================================================

/**
 * 步骤 1: 下载图片并上传到 HuggingFace
 */
async function uploadImageToHF(imageUrl) {
    // 对 URL 进行解码（CQ 码中可能含 HTML 实体或编码）
    let cleanUrl = imageUrl
        .replace(/&amp;/g, '&')
        .replace(/&#44;/g, ',');

    // 下载图片 — QQ 图片服务器需要 User-Agent 和 Referer
    const imgRes = await fetch(cleanUrl, buildFetchOptions({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://qq.com',
        },
    }));
    if (!imgRes.ok) throw new Error(`下载图片失败: ${imgRes.status} (URL: ${cleanUrl.substring(0, 80)}...)`);
    const imgBlob = await imgRes.blob();

    // 上传到 HuggingFace
    const hash = Date.now();
    const formData = new FormData();
    formData.append("files", imgBlob);

    const uploadRes = await fetch(
        `${HF_BASE_URL}/upload?upload_id=${hash}`,
        buildFetchOptions({
            method: "POST",
            body: formData,
        })
    );
    if (!uploadRes.ok) throw new Error(`上传图片到 HuggingFace 失败: ${uploadRes.status}`);

    const uploadPaths = await uploadRes.json();
    return { path: uploadPaths[0], hash: String(hash) };
}

/**
 * 步骤 2: 提交推理请求到队列
 */
async function joinQueue(filePath, sessionHash) {
    const body = {
        data: [
            {
                path: filePath,
                size: null,
                mime_type: "",
            },
            currentConfig.model,
            parseFloat(currentConfig.generalThreshold) || 0.35,
            false, // useMCutThreshold for general
            parseFloat(currentConfig.characterThreshold) || 0.85,
            false, // useMCutThreshold for character
        ],
        event_data: null,
        fn_index: 2,
        trigger_id: 18,
        session_hash: sessionHash,
    };

    const res = await fetch(
        `${HF_BASE_URL}/queue/join`,
        buildFetchOptions({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
    );
    if (!res.ok) throw new Error(`加入推理队列失败: ${res.status}`);
}

/**
 * 步骤 3: 轮询获取推理结果（SSE 流式）
 */
async function fetchResult(sessionHash) {
    const res = await fetch(
        `${HF_BASE_URL}/queue/data?session_hash=${sessionHash}`,
        buildFetchOptions()
    );
    if (!res.ok) throw new Error(`获取推理结果失败: ${res.status}`);

    const text = await res.text();
    // SSE 格式解析：找到包含 process_completed 的事件，提取 JSON
    const lines = text.split("\n");
    for (const line of lines) {
        if (line.startsWith("data: ") && line.includes("process_completed")) {
            const jsonStr = line.slice(6); // 去掉 "data: "
            const parsed = JSON.parse(jsonStr);
            return parsed.output.data;
        }
    }
    throw new Error("未收到推理完成事件");
}

/**
 * 格式化识别结果
 */
function formatResult(data) {
    // data[0] = 标签文本
    // data[1] = { label, confidences } 安全评级
    // data[2] = { label, confidences } 角色识别
    let result = `标签：\n${data[0]}\n\n角色：${data[2]?.label ?? "未知"}`;

    if (data[2]?.label && data[2]?.confidences) {
        for (const character of data[2].confidences) {
            result += `\n${character.label} (${Math.trunc(character.confidence * 100)}%)`;
        }
    }

    result += `\n\n安全程度：${data[1]?.label ?? "未知"}`;
    if (data[1]?.confidences) {
        for (const rating of data[1].confidences) {
            result += `\n${rating.label} (${Math.trunc(rating.confidence * 100)}%)`;
        }
    }

    return result;
}

// ============================================================
// 消息处理
// ============================================================
async function onMessage(ctx, event) {
    if (event.message_type !== "group") return;

    const msg = event.raw_message?.trim() || "";

    // 触发词匹配：精确 "rec" 或以 "rec " 开头
    if (msg !== "rec" && !msg.startsWith("rec ")) return;

    const groupId = event.group_id;
    let imageUrl = null;

    // 1. 尝试从消息本身提取图片
    imageUrl = extractImageUrl(msg);

    // 2. 如果消息无图，尝试从引用的消息中提取图片
    if (!imageUrl && event.message) {
        // event.message 是消息段数组，查找 reply 段获取被引用消息 ID
        const replySegment = event.message.find(seg => seg.type === "reply");
        if (replySegment) {
            try {
                // 通过 OB11 API 获取被引用消息
                const quotedMsg = await callOB11(ctx, "get_msg", { message_id: replySegment.data.id });
                if (quotedMsg?.message) {
                    // 从引用消息的段中查找图片
                    const imgSeg = quotedMsg.message.find(seg => seg.type === "image");
                    if (imgSeg?.data?.url) {
                        imageUrl = imgSeg.data.url;
                    } else if (imgSeg?.data?.file) {
                        imageUrl = imgSeg.data.file;
                    }
                }
                // 也尝试从 raw_message 中提取
                if (!imageUrl && quotedMsg?.raw_message) {
                    imageUrl = extractImageUrl(quotedMsg.raw_message);
                }
            } catch (e) {
                ctx.logger.error("[WD-Tagger] 获取引用消息失败", e);
            }
        }
    }

    if (!imageUrl) {
        await sendGroupMsg(ctx, groupId, "请附带图片或引用一条含图片的消息再发送 rec");
        return;
    }

    // 通知用户正在识别
    await sendGroupMsg(ctx, groupId, "正在识别，请稍等...");

    try {
        // HuggingFace Gradio API 三步流程
        ctx.logger.info("[WD-Tagger] 开始上传图片...");
        const { path: filePath, hash: sessionHash } = await uploadImageToHF(imageUrl);

        ctx.logger.info("[WD-Tagger] 加入推理队列...");
        await joinQueue(filePath, sessionHash);

        ctx.logger.info("[WD-Tagger] 等待推理结果...");
        const data = await fetchResult(sessionHash);

        const result = formatResult(data);
        await sendGroupMsg(ctx, groupId, result);
    } catch (e) {
        ctx.logger.error("[WD-Tagger] 识别失败", e);
        await sendGroupMsg(ctx, groupId, `识别失败: ${e.message}`);
    }
}

// ============================================================
// 插件生命周期导出
// ============================================================
export let plugin_config_ui = [];

export async function plugin_init(ctx) {
    ctx.logger.info("[WD-Tagger] 插件加载中...");
    loadConfig(ctx);
    plugin_config_ui = buildConfigUI(ctx);
}

export async function plugin_onmessage(ctx, event) {
    if (event.post_type !== 'message') return;
    await onMessage(ctx, event);
}

export async function plugin_cleanup(ctx) {
    ctx.logger.info("[WD-Tagger] 插件已卸载");
}

export async function plugin_get_config(ctx) {
    return currentConfig;
}

export async function plugin_set_config(ctx, config) {
    currentConfig = { ...DEFAULT_CONFIG, ...config };
    saveConfig(ctx, currentConfig);
    ctx.logger.info("[WD-Tagger] 配置已通过 WebUI 更新");
}

export async function plugin_on_config_change(ctx, _, key, value) {
    saveConfig(ctx, { [key]: value });
}
