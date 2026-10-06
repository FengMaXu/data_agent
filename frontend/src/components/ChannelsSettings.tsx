import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { disconnectChannelViaRuntime, listChannelsViaRuntime, provisionChannelViaRuntime, type ChannelStatusView } from '../api/runtime-client';

const STATE_LABEL: Record<ChannelStatusView['state'], { text: string; color: string; background: string }> = {
    unconfigured: { text: '未接入', color: '#6b7280', background: '#f3f4f6' },
    provisioning: { text: '等待扫码', color: '#92400e', background: '#fef3c7' },
    connected: { text: '已连接', color: '#065f46', background: '#d1fae5' },
    failed: { text: '连接失败', color: '#991b1b', background: '#fee2e2' },
};

/** How often the page asks for news while someone is scanning. */
const POLL_MS = 2000;

const QrLink: React.FC<{ url: string; expiresAt: number }> = ({ url, expiresAt }) => {
    const [image, setImage] = useState<string>();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        let cancelled = false;
        QRCode.toDataURL(url, { margin: 1, width: 200 }).then((data) => { if (!cancelled) setImage(data); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [url]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
    return (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginTop: '16px' }}>
            {image ? <img src={image} width={200} height={200} alt="用飞书扫码接入" style={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} /> : <Loader2 size={24} className="animate-spin" />}
            <div style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7 }}>
                <div>用手机飞书扫码，按页面提示创建机器人并确认授权。</div>
                <div>也可以 <a href={url} target="_blank" rel="noreferrer">在本机飞书中打开</a>。</div>
                <div style={{ color: '#6b7280' }}>{seconds > 0 ? `二维码 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后过期` : '二维码已过期，请重新扫码'}</div>
            </div>
        </div>
    );
};

/** Settings page section for IM channels: scan to connect, see state, disconnect. Credentials never reach the page. */
const ChannelsSettings: React.FC = () => {
    const [channels, setChannels] = useState<ChannelStatusView[]>();
    const [unavailable, setUnavailable] = useState(false);
    const [busy, setBusy] = useState<string>();

    const refresh = useCallback(async () => {
        try {
            setChannels(await listChannelsViaRuntime());
            setUnavailable(false);
        } catch {
            setUnavailable(true);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const scanning = channels?.some((channel) => channel.state === 'provisioning') ?? false;
    useEffect(() => {
        if (!scanning) return;
        const timer = setInterval(() => { void refresh(); }, POLL_MS);
        return () => clearInterval(timer);
    }, [scanning, refresh]);

    const run = async (channelId: string, action: (id: string) => Promise<ChannelStatusView[]>) => {
        setBusy(channelId);
        try {
            setChannels(await action(channelId));
        } catch {
            await refresh();
        } finally {
            setBusy(undefined);
        }
    };

    if (unavailable) {
        return <p className="settings-section-desc">当前运行方式没有启用消息渠道，或暂时无法读取渠道状态。</p>;
    }
    if (!channels) return <Loader2 size={20} className="animate-spin" />;

    return (
        <div className="settings-tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p className="settings-section-desc" style={{ margin: 0 }}>接入后，可以在 IM 里直接向数据智能体提问、接收查询结果和看板。发送 /new 可随时开始新对话。</p>
            {channels.map((channel) => {
                const state = STATE_LABEL[channel.state];
                const working = busy === channel.id;
                return (
                    <section key={channel.id} aria-label={channel.label} style={{ background: '#fff', borderRadius: '16px', padding: '24px', border: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h3 className="settings-section-title" style={{ margin: 0 }}>{channel.label}</h3>
                            <span style={{ fontSize: '0.8rem', padding: '2px 10px', borderRadius: '999px', color: state.color, background: state.background }}>{state.text}</span>
                            <div style={{ flex: 1 }} />
                            {channel.provisionable && (
                                <button type="button" className="form-action-btn" disabled={working} onClick={() => run(channel.id, provisionChannelViaRuntime)}>
                                    {working ? <Loader2 size={16} className="animate-spin" /> : null}
                                    {channel.state === 'unconfigured' ? '扫码接入' : '重新扫码'}
                                </button>
                            )}
                            {(channel.state === 'connected' || channel.state === 'failed') && (
                                <button type="button" className="form-action-btn" disabled={working} onClick={() => { if (window.confirm(`断开${channel.label}？已保存的接入凭证会被删除。`)) void run(channel.id, disconnectChannelViaRuntime); }}>断开</button>
                            )}
                        </div>
                        {channel.provisioning && channel.state === 'provisioning' && <QrLink url={channel.provisioning.url} expiresAt={channel.provisioning.expiresAt} />}
                        {channel.message && <div role="alert" style={{ marginTop: '12px', color: '#991b1b', fontSize: '0.9rem' }}>{channel.message}</div>}
                        {channel.warnings?.map((warning) => (
                            <div key={warning} role="status" style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', fontSize: '0.9rem', wordBreak: 'break-all' }}>还差一步：{warning}</div>
                        ))}
                    </section>
                );
            })}
        </div>
    );
};

export default ChannelsSettings;
