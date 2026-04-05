import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'zh';

interface Translations {
    [key: string]: {
        [key: string]: string;
    };
}

// Translations dictionary
const translations: Translations = {
    en: {
        'sidebar.newWorkspace': 'New Workspace',
        'sidebar.chat': 'Chat',
        'sidebar.knowledge': 'Knowledge',
        'sidebar.workspace': 'Workspace Files',
        'sidebar.history': 'Workspace History',
        'sidebar.plugins': 'Plugins',
        'sidebar.metrics': 'Metrics',
        'sidebar.settings': 'Settings',
        'sidebar.langToggle': '切换至中文',

        'settings.title': 'Settings',
        'settings.model': 'Model',
        'settings.database': 'Database',
        'settings.modelSettings': 'Model Settings',
        'settings.providers': 'Providers',
        'settings.defaultModelTitle': 'Default Model and Provider',
        'settings.defaultModelSubtitle': 'Agent Working Model',
        'settings.defaultModelHint': 'Tip: To change the working model, select the provider on the left, enable it, and select the desired model.',
        'settings.historyLimitTitle': 'Chat History Limit',
        'settings.maxTurns': 'Max Dialogue Turns',
        'settings.maxTurnsSubtitle': 'Number of retained turns (0 = unlimited)',
        'settings.maxTokens': 'Max History Tokens',
        'settings.maxTokensSubtitle': 'Max retained tokens (0 = unlimited)',
        'settings.apiKeyTitle': 'API Key',
        'settings.apiKeyPlaceholder': 'To keep current, enter [configured]',
        'settings.supportModels': 'Supported Models',
        'settings.refreshModels': 'Refresh Available Models from API',
        'settings.howToGetToken': 'How to get an API Token?',
        'settings.enableProvider': 'Enable this provider to use its models in chat',
        'settings.save': 'Save Settings',
        'settings.dbSettings': 'MySQL Database Configuration',
        'settings.dbHost': 'Host',
        'settings.dbPort': 'Port',
        'settings.dbUser': 'Username',
        'settings.dbPassword': 'Password',
        'settings.dbPasswordPlaceholder': 'Enter password or leave blank if no auth',
        'settings.dbDatabase': 'Database Name',
        'settings.dbTest': 'Test Connection',
        'settings.testing': 'Testing...',
        'settings.enabled': 'Enabled (Current Worker)',
        'settings.disabled': 'Disabled',

        'plugins.mcp': 'MCP Settings',
        'plugins.skills': 'Skills Settings',
        'plugins.installed': 'Installed',
        'plugins.addNew': 'Install New',
        'plugins.status': 'Status',
        'plugins.connected': 'Connected',
        'plugins.disconnected': 'Disconnected',
        'plugins.toolsNum': 'Total Tools',
        'plugins.addNewServer': 'Add New MCP Server',
        'plugins.installLabel': 'Install via Command / Package',
        'plugins.installPlaceholder': 'e.g., npx -y @server/foo',
        'plugins.envLabel': 'Environment Variables (JSON)',
        'plugins.envPlaceholder': '{"TOKEN": "abc"} (Optional)',
        'plugins.serverName': 'Server Identifier',
        'plugins.installing': 'Installing...',
        'plugins.install': 'Install',
        'plugins.noServers': 'No MCP servers configured',
        'plugins.settings': 'Settings',
        'plugins.mcpDesc': 'Manage MCP Server configurations, connection states, and bridge tools.',
        'plugins.refresh': 'Refresh',
        'plugins.add': 'Add',
        'plugins.disabled': 'Disabled',
        'plugins.noDesc': 'No description',
        'plugins.edit': 'Edit',
        'plugins.noSrvHint': 'No MCP server yet, click "Add" on the top right.',
        'plugins.unnamedSrv': 'Unnamed server',
        'plugins.selectHint': 'Please select an MCP server from the left to edit.',
        'plugins.searchSkill': 'Search Skill',
        'plugins.noSkills': 'No Skills',
        'plugins.loadingSkills': 'Loading Skills...',

        'chat.workspaceEmpty': 'No files attached.',
        'chat.clearChat': 'Clear Chat',
        'chat.stop': 'Stop',
        'chat.send': 'Send',
        'chat.placeholder': 'Enter your request or question here...',
        'chat.you': 'You',
        'chat.agent': 'Agent',
        'chat.needsClarification': 'Needs your clarification',
        'chat.inputAnswer': 'Enter your answer...',
        'chat.submitting': 'Submitting...',
        'chat.submit': 'Submit',
        'chat.steerHint': 'Additional instructions will be sent as steer/follow-up',
        'chat.attachHint': 'Select files in Workspace to attach to this query',
        'chat.status': 'Status',
        'chat.stopped': 'Stopped',
        'chat.uploadTooltip': 'Upload to workspace',
        'chat.steerPlaceholder': 'Steering instructions...',
        'chat.startMessage': 'Send a message to start...',
        
        'tools.processing': 'Processing...',
        'tools.statusError': 'Error',
        'tools.statusDone': 'Done',
        'tools.statusRunning': 'Running',
        'tools.args': 'Arguments',
        'tools.result': 'Result',
        'tools.details': 'Details',
        'tools.copy': 'Copy',
        'tools.noCalls': 'No tool calls yet',

        'widgets.true': 'Yes',
        'widgets.false': 'No',
        'widgets.metric': 'Metric',
        'widgets.column': 'Column',
        'widgets.dataPoint': 'Data Point',
        'widgets.step': 'Step',
        'widgets.download': 'Download',
        'widgets.renderFail': 'Widget render failed',

        'session.newWorkspace': 'New Workspace',
        'session.workspacePrefix': 'Workspace'
    },
    zh: {
        'sidebar.newWorkspace': '新建工作区',
        'sidebar.chat': '对话',
        'sidebar.knowledge': '知识库',
        'sidebar.workspace': '工作区文件',
        'sidebar.history': '历史工作区',
        'sidebar.plugins': '插件管理',
        'sidebar.metrics': '指标',
        'sidebar.settings': '设置',
        'sidebar.langToggle': 'Switch to English',

        'settings.title': '系统设置',
        'settings.model': '模型',
        'settings.database': '数据库',
        'settings.modelSettings': '模型设置',
        'settings.providers': '供应商',
        'settings.defaultModelTitle': '配置默认模型和供应商',
        'settings.defaultModelSubtitle': 'Agent 工作模型',
        'settings.defaultModelHint': '提示：要更改工作模型，请在左侧选择对应的供应商，然后开启供应商并选择所需模型。',
        'settings.historyLimitTitle': '对话历史限制',
        'settings.maxTurns': '最大对话轮次',
        'settings.maxTurnsSubtitle': '保留的对话轮次数量（0 = 不限制）',
        'settings.maxTokens': '最大历史 Token 数',
        'settings.maxTokensSubtitle': '对话中的最大 Token 数量（0 = 不限制）',
        'settings.apiKeyTitle': 'API 密钥',
        'settings.apiKeyPlaceholder': '留空表示不修改，如有请填写',
        'settings.supportModels': '支持的模型',
        'settings.refreshModels': '刷新模型列表',
        'settings.howToGetToken': '如何获取 API 令牌？',
        'settings.enableProvider': '开启此供应商以在聊天时使用其模型',
        'settings.save': '保存设置',
        'settings.dbSettings': 'MySQL 数据库配置',
        'settings.dbHost': '主机地址',
        'settings.dbPort': '端口',
        'settings.dbUser': '用户名',
        'settings.dbPassword': '密码',
        'settings.dbPasswordPlaceholder': '输入密码，若无请留空',
        'settings.dbDatabase': '数据库名称',
        'settings.dbTest': '测试连接',
        'settings.testing': '测试中...',
        'settings.enabled': '已启用 (当前工作平台)',
        'settings.disabled': '已停用',

        'plugins.mcp': 'MCP 设置',
        'plugins.skills': 'Skills 设置',
        'plugins.installed': '已安装',
        'plugins.addNew': '安装新插件',
        'plugins.status': '状态',
        'plugins.connected': '已连接',
        'plugins.disconnected': '未连接',
        'plugins.toolsNum': '工具数量',
        'plugins.addNewServer': '添加新 MCP 服务',
        'plugins.installLabel': '运行命令 / 包名',
        'plugins.installPlaceholder': '例：npx -y @server/foo',
        'plugins.envLabel': '环境变量 (JSON格式)',
        'plugins.envPlaceholder': '{"KEY": "value"}（可选）',
        'plugins.serverName': '服务标识符',
        'plugins.installing': '安装中...',
        'plugins.install': '安装',
        'plugins.noServers': '暂无 MCP 服务器配置',
        'plugins.settings': '设置',
        'plugins.mcpDesc': '管理 MCP Server 配置、连接状态与桥接工具。',
        'plugins.refresh': '刷新',
        'plugins.add': '添加',
        'plugins.disabled': '已禁用',
        'plugins.noDesc': '暂无描述',
        'plugins.edit': '编辑',
        'plugins.noSrvHint': '还没有 MCP server，点击右上角“添加”。',
        'plugins.unnamedSrv': '未命名 server',
        'plugins.selectHint': '请选择左侧的 MCP server 进行编辑。',
        'plugins.searchSkill': '搜索 Skill',
        'plugins.noSkills': '暂无 Skills',
        'plugins.loadingSkills': '正在加载 Skills...',

        'chat.workspaceEmpty': '当前未附加工作区文件',
        'chat.clearChat': '清空对话',
        'chat.stop': '停止生成',
        'chat.send': '发送消息',
        'chat.placeholder': '在这里输入您的问题或请求...',
        'chat.you': '您',
        'chat.agent': '助手',
        'chat.needsClarification': '需要你的澄清',
        'chat.inputAnswer': '输入你的回答...',
        'chat.submitting': '提交中...',
        'chat.submit': '提交',
        'chat.steerHint': '执行中补充说明会作为 steer/follow-up 发送',
        'chat.attachHint': '可在左侧 Workspace 勾选文件后附加到本次提问',
        'chat.status': '状态',
        'chat.stopped': '已停止',
        'chat.uploadTooltip': '上传到当前会话工作区',
        'chat.steerPlaceholder': '执行中补充说明...',
        'chat.startMessage': '发送一条消息开始会话...',
        
        'tools.processing': '执行中...',
        'tools.statusError': '错误',
        'tools.statusDone': '完成',
        'tools.statusRunning': '执行中',
        'tools.args': '工具参数',
        'tools.result': '工具结果',
        'tools.details': '详细信息',
        'tools.copy': '复制',
        'tools.noCalls': '暂无工具调用',

        'widgets.true': '是',
        'widgets.false': '否',
        'widgets.metric': '指标',
        'widgets.column': '列',
        'widgets.dataPoint': '数据点',
        'widgets.step': '步骤',
        'widgets.download': '下载',
        'widgets.renderFail': '组件渲染失败',

        'session.newWorkspace': '新建工作区',
        'session.workspacePrefix': '工作区'
    }
};

interface LanguageContextProps {
    language: Language;
    toggleLanguage: () => void;
    t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Default language is 'zh' as requested
    const [language, setLanguage] = useState<Language>('zh');

    // Optionally load from localStorage on mount
    useEffect(() => {
        const savedLang = localStorage.getItem('app_language') as Language;
        if (savedLang && (savedLang === 'en' || savedLang === 'zh')) {
            setLanguage(savedLang);
        }
    }, []);

    const toggleLanguage = () => {
        const nextLang = language === 'zh' ? 'en' : 'zh';
        setLanguage(nextLang);
        localStorage.setItem('app_language', nextLang);
    };

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = (): LanguageContextProps => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
