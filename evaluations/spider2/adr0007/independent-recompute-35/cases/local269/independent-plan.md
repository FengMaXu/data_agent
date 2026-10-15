# 独立推导
原题逐字：“What is the average total quantity across all final packaging combinations, considering only the leaf-level items within each combination after fully expanding any nested packaging relationships?”
将包装关系视为有向数量图，父包装包含qty单位子包装。完全展开时沿路径乘数量，多个叶路径相加。组合是最终（不被其他包装包含）外层包装；先观察图结构确认可能解释。根层每个组合得叶数量总和，再对组合等权平均。叶本身没有关系，不自动算成最终组合，除非数据表明这些是孤立可售包装。检查环、根、共享叶及多路径。
