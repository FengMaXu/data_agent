# 独立题解（揭示前）
原题：“Which player has participated in the highest number of winning matches and which player has participated in the highest number of losing matches, considering only matches where they actually played (excluding null entries) and where their team won or lost (excluding draws)?”
将每场主客队11个非空player_api_id展开；按比分为各方标记Win/Loss，去除平局。业务单位是球员身份×比赛，不是姓名也不是球队所有历史成员。每个球员同场最多计一次（极端同场两边出现的脏数据按同一结果去重并检测）。按身份累计胜、负场，各取全局最大；并列全保留。通过Player.player_api_id获取姓名。X/Y是位置坐标，不是球员身份。所有赛季无时间过滤。
缺少上场分钟/替补明细，因此把非空阵容身份当作实际参赛的可用代理，不能声称记录证明真实上场分钟。验证身份关联完整性、阵容重复、胜负守恒及最高者的主客分解。最后输出结果类型、球员名、比赛数。
