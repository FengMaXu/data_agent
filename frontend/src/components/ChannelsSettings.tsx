import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { createChannelBindCodeViaRuntime, decideChannelAccessViaRuntime, disconnectChannelViaRuntime, listChannelAccessViaRuntime, listChannelsViaRuntime, provisionChannelViaRuntime, revokeChannelAccessViaRuntime, type ChannelAccessView, type ChannelStatusView } from '../api/runtime-client';

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

/**
 * Only IM identities linked to an account may use a bot. The code links whoever
 * sends it, in a private chat with the bot, to the account signed in here.
 */
const LinkAccount: React.FC = () => {
    const [link, setLink] = useState<{ code: string; expiresAt: number }>();
    const [failed, setFailed] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!link) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [link]);
    const issue = async () => {
        setFailed(false);
        try {
            setLink(await createChannelBindCodeViaRuntime());
            setNow(Date.now());
        } catch {
            setFailed(true);
        }
    };
    const seconds = link ? Math.max(0, Math.round((link.expiresAt - now) / 1000)) : 0;
    return (
        <section aria-label="绑定我的 IM 账号" style={{ background: '#fff', borderRadius: '16px', padding: '24px', border: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 className="settings-section-title" style={{ margin: 0 }}>绑定我的 IM 账号</h3>
                <div style={{ flex: 1 }} />
                <button type="button" className="form-action-btn" onClick={() => { void issue(); }}>{link ? '重新获取' : '获取绑定码'}</button>
            </div>
            <p className="settings-section-desc" style={{ margin: '8px 0 0' }}>机器人只回应已绑定账号的人。绑定后，你在 IM 里的对话会出现在这个账号下；查询用的是本应用配置的数据库，绑定任何人都等于让他能查询这些数据。</p>
            {link && seconds > 0 && (
                <div style={{ marginTop: '16px', fontSize: '0.95rem', color: '#374151', lineHeight: 1.8 }}>
                    <div>在与机器人的<strong>私聊</strong>中发送：<code style={{ fontSize: '1.1rem', padding: '2px 8px', background: '#f3f4f6', borderRadius: '6px' }}>/bind {link.code}</code></div>
                    <div style={{ color: '#6b7280' }}>绑定码只能用一次，{Math.floor(seconds / 60)} 分 {seconds % 60} 秒后过期。不要发到群里。</div>
                </div>
            )}
            {link && seconds === 0 && <div style={{ marginTop: '12px', color: '#6b7280' }}>绑定码已过期，请重新获取。</div>}
            {failed && <div role="alert" style={{ marginTop: '12px', color: '#991b1b' }}>无法获取绑定码，请稍后重试。</div>}
        </section>
    );
};

const PLATFORM: Record<string, string> = { feishu: '飞书' };
/** IM ids are long and opaque; a short form is enough to tell people apart. */
const shortId = (id: string) => id.length > 12 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id;
const when = (at: number) => new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Who may use the bots, and who is waiting. Deciding here is the same as tapping the card in the IM. */
const AccessList: React.FC = () => {
    const [access, setAccess] = useState<ChannelAccessView>();
    const [failed, setFailed] = useState(false);
    const apply = async (action: () => Promise<ChannelAccessView>) => {
        try {
            setAccess(await action());
            setFailed(false);
        } catch {
            setFailed(true);
        }
    };
    useEffect(() => { void apply(listChannelAccessViaRuntime); }, []);
    if (failed && !access) return null;
    const cell: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'left', fontSize: '0.9rem' };
    return (
        <section aria-label="授权名单" style={{ background: '#fff', borderRadius: '16px', padding: '24px', border: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 className="settings-section-title" style={{ margin: 0 }}>授权名单</h3>
                <div style={{ flex: 1 }} />
                <button type="button" className="form-action-btn" onClick={() => { void apply(listChannelAccessViaRuntime); }}>刷新</button>
            </div>
            <p className="settings-section-desc" style={{ margin: '8px 0 16px' }}>没有权限的人给机器人发消息时，会向已绑定账号的成员发出使用申请。账号成员可以审批别人；访客只能使用。</p>
            {!access ? <Loader2 size={20} className="animate-spin" /> : (
                <>
                    <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>待处理的申请</h4>
                    {access.requests.length === 0 ? <p className="settings-section-desc">没有待处理的申请。</p> : access.requests.map((request) => (
                        <div key={request.id} role="group" aria-label={`申请 ${shortId(request.requester.externalUserId)}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '10px', background: '#fffbeb', marginBottom: '8px' }}>
                            <div style={{ flex: 1, fontSize: '0.9rem', color: '#374151' }}>
                                <div>{PLATFORM[request.requester.channel] ?? request.requester.channel} · {shortId(request.requester.externalUserId)} · {request.audience === 'group' ? '群聊' : '私聊'} · {when(request.at)}</div>
                                {request.text && <div style={{ color: '#6b7280', marginTop: '4px', wordBreak: 'break-all' }}>“{request.text}”</div>}
                            </div>
                            <button type="button" className="form-action-btn" onClick={() => { if (window.confirm('允许后，对方能查询本应用可以访问的全部数据。确定允许？')) void apply(() => decideChannelAccessViaRuntime(request.id, 'allow')); }}>允许</button>
                            <button type="button" className="form-action-btn" onClick={() => { void apply(() => decideChannelAccessViaRuntime(request.id, 'deny')); }}>拒绝</button>
                        </div>
                    ))}
                    <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem' }}>可以使用的人</h4>
                    {access.members.length === 0 ? <p className="settings-section-desc">还没有人。先用上面的绑定码绑定你自己的 IM 账号。</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={cell}>平台</th><th style={cell}>IM 账号</th><th style={cell}>身份</th><th style={cell}>开始时间</th><th style={cell} /></tr></thead>
                            <tbody>
                                {access.members.map((member) => (
                                    <tr key={`${member.actor.channel}|${member.actor.tenant}|${member.actor.externalUserId}`}>
                                        <td style={cell}>{PLATFORM[member.actor.channel] ?? member.actor.channel}</td>
                                        <td style={cell} title={member.actor.externalUserId}>{shortId(member.actor.externalUserId)}</td>
                                        <td style={cell}>{member.role === 'account' ? '账号成员' : '访客'}</td>
                                        <td style={cell}>{when(member.since)}</td>
                                        <td style={{ ...cell, textAlign: 'right' }}>
                                            <button type="button" className="form-action-btn" onClick={() => { if (window.confirm('撤销后，对方再发消息需要重新申请。确定撤销？')) void apply(() => revokeChannelAccessViaRuntime(member.actor)); }}>撤销</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {failed && <div role="alert" style={{ marginTop: '12px', color: '#991b1b' }}>操作没有成功，请刷新后重试。</div>}
                </>
            )}
        </section>
    );
};

/** Settings page section for IM channels: scan to connect, see state, disconnect, link an account, decide who may use them. Credentials never reach the page. */
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
            <LinkAccount />
            <AccessList />
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
