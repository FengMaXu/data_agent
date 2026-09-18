# HTML 看板沉浸式预览功能改造方案（生产级）

## 一、 设计原则与架构选型

为了确保方案具备“生产级”的标准，并且拒绝胶水代码凑合，我们需要遵循以下核心设计原则：

1. **状态全局化 (Global State Management)**：不能在 `FileLinkWidget` 内部就地写一个 Modal 弹窗。因为聊天消息组件在滚动条中随时可能被复用或卸载，且局部的 Modal 极易引发 Z-Index 层级冲突。必须在整个应用的最顶层（通常在 `App.tsx` 或 `Layout.tsx`）挂载一个**全局预览容器**。
2. **职责单一原则 (Single Responsibility)**：
   - `FileLinkWidget` 只负责展示元数据并分发“预览/下载”的动作指令。
   - `PreviewContext` 只负责管理当前的预览状态（正在看哪个文件，是否全屏等）。
   - `GlobalPreviewModal` 只负责承载 Iframe 并处理与 Iframe 的通信。
3. **通信闭环 (Two-way Communication)**：看板本身具备交互性（如下钻）。`dashboard_template.html` 已经预留了 `window.parent.postMessage`，全局预览容器必须监听这些消息，将其转化为系统的动作（例如让 Agent 发起下钻查询）。

## 二、 核心架构改造路径

### 1. 新增：全局预览上下文 (`src/context/PreviewContext.tsx`)

创建一个专门管理所有类型文件预览的 Context。这不仅能看 HTML，未来还能拓展看 PDF、图片等。

```tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface PreviewContextState {
    isOpen: boolean;
    url: string | null;
    title: string;
    fileType: string;
    openPreview: (url: string, title: string, fileType: string) => void;
    closePreview: () => void;
}

const PreviewContext = createContext<PreviewContextState | undefined>(undefined);

export const PreviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [url, setUrl] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [fileType, setFileType] = useState('');

    const openPreview = (newUrl: string, newTitle: string, newType: string) => {
        setUrl(newUrl);
        setTitle(newTitle);
        setFileType(newType);
        setIsOpen(true);
    };

    const closePreview = () => {
        setIsOpen(false);
        setUrl(null);
    };

    return (
        <PreviewContext.Provider value={{ isOpen, url, title, fileType, openPreview, closePreview }}>
            {children}
        </PreviewContext.Provider>
    );
};

export const usePreview = () => {
    const context = useContext(PreviewContext);
    if (!context) throw new Error('usePreview must be used within a PreviewProvider');
    return context;
};
```

### 2. 新增：全局模态框组件 (`src/components/common/GlobalPreviewModal.tsx`)

在应用层级最高的地方（或者直接放在 `PreviewProvider` 内部）渲染该弹窗。

```tsx
import React, { useEffect } from 'react';
import { usePreview } from '../../context/PreviewContext';

const GlobalPreviewModal: React.FC = () => {
    const { isOpen, url, title, fileType, closePreview } = usePreview();

    // 监听从 iframe 内部发来的 postMessage（如下钻事件）
    useEffect(() => {
        if (!isOpen) return;

        const handleIframeMessage = (event: MessageEvent) => {
            // 安全校验：如果需要的话，检查 event.origin
            const data = event.data;
            if (data?.type === 'drill_down') {
                console.log('接收到看板下钻请求:', data);
                // 这里可以调用 Agent API 发送下钻指令，或者通过全局状态分发动作
                // 此时也可以选择 closePreview() 收起弹窗，让用户看到聊天流的更新
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, [isOpen]);

    if (!isOpen || !url) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm transition-opacity">
            <div className="flex flex-col w-[90vw] h-[90vh] bg-white rounded-xl shadow-2xl overflow-hidden">
                {/* 模态框头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
                    <button 
                        onClick={closePreview}
                        className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-full transition-colors"
                    >
                        {/* 关闭图标 */}
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                {/* 内容渲染区 */}
                <div className="flex-1 w-full h-full bg-gray-100 relative">
                    {fileType === 'html' ? (
                        <iframe 
                            src={url} 
                            title={title}
                            className="absolute inset-0 w-full h-full border-none"
                            // iframe 安全沙箱策略，允许执行脚本，允许同源策略（以便访问内部资源）
                            sandbox="allow-scripts allow-same-origin allow-downloads"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            当前文件格式（{fileType}）暂不支持内联预览
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GlobalPreviewModal;
```

### 3. 改造：`WidgetRenderer.tsx` 中的 `FileLinkWidget`

将原本单一的下载功能，拆分为“查看”与“下载”并列，同时引入全局上下文。

```tsx
import { usePreview } from '../../context/PreviewContext';

// ... 其他代码保留

const FileLinkWidget: React.FC<FileLinkWidgetProps> = ({ widget, t }) => {
    const { file_path, download_url, file_type, title, subtitle } = widget;
    const { openPreview } = usePreview(); // 引入全局预览钩子

    const fullUrl = resolveInternalUrl(download_url);

    // 现有的下载逻辑保留
    const handleDownload = () => {
        if (fullUrl) {
            const link = document.createElement('a');
            link.href = fullUrl;
            link.download = file_path?.split('/').pop() || 'dashboard.html';
            link.click();
        }
    };

    // 新增预览逻辑
    const handlePreview = () => {
        if (fullUrl) {
            // 如果是 HTML 看板，我们触发弹窗。你可以根据需要扩大支持的 file_type
            openPreview(fullUrl, title || '数据看板', file_type || 'html');
        }
    };

    const isPreviewable = file_type === 'html';

    return (
        <div style={{ /* 现有样式保留 */ border: '1px solid #e5e7eb', borderRadius: '8px', background: 'white', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ fontSize: '32px' }}>{getFileIcon()}</div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{title}</div>
                    {subtitle && <div style={{ fontSize: '13px', color: '#6b7280' }}>{subtitle}</div>}
                </div>
                
                {/* 操作按钮区组 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    {/* 新增查看按钮 */}
                    {isPreviewable && (
                        <button
                            onClick={handlePreview}
                            style={{
                                padding: '8px 16px',
                                background: '#3b82f6', // 使用主色调突出预览
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 500
                            }}
                        >
                            {t('widgets.preview') || '查看看板'}
                        </button>
                    )}
                    
                    {/* 原始下载按钮（降级为次要按钮样式） */}
                    <button
                        onClick={handleDownload}
                        style={{
                            padding: '8px 16px',
                            background: 'white',
                            color: '#6b7280',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 500
                        }}
                    >
                        {t('widgets.download') || '下载'}
                    </button>
                </div>
            </div>
        </div>
    );
};
```

### 4. 装载上下文 (全局入口文件 `App.tsx` 或 `main.tsx`)

确保应用被 Provider 包裹，且在其中挂载 Global Modal。

```tsx
import { PreviewProvider } from './context/PreviewContext';
import GlobalPreviewModal from './components/common/GlobalPreviewModal';

const App = () => {
  return (
    <PreviewProvider>
       <YourMainLayout>
          {/* 其他聊天组件 */}
       </YourMainLayout>
       {/* 挂载全局预览弹窗，因为受 Context 控制，放在这就行 */}
       <GlobalPreviewModal /> 
    </PreviewProvider>
  );
};
```

## 三、 方案优势总结

1. **绝对解耦**：底层的小卡片（`FileLinkWidget`）不再包含庞大的 HTML 渲染逻辑和 DOM 操作，非常清爽，只负责发射 `openPreview` 信号。
2. **复用性强**：`PreviewContext` 是一套通用的资产预览机制。后续如果你想加 PDF 预览（换个 iframe）、图片全屏查看（换个 img 标签），都可以复用这个顶层弹窗，只需稍微扩充一下逻辑即可。
3. **沉浸式交互**：用户不离开聊天流即可完成重度数据看板的审查，这对于 Agent 交互体验来说是质的飞跃。Iframe 与顶层的 `postMessage` 通信信道，为日后“**看着大屏点数据，Agent 自动在底下接着聊**”的终极科幻形态打下了完美的地基。
