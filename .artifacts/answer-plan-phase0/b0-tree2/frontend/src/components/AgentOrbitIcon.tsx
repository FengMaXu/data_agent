import React from 'react';

interface AgentOrbitIconProps {
    size?: number | string;
    animated?: boolean;
    className?: string;
}

const AgentOrbitIcon: React.FC<AgentOrbitIconProps> = ({
    size = 24,
    animated = false,
    className = '',
}) => {
    const svgClassName = ['agent-orbit-icon', animated ? 'is-animated' : '', className]
        .filter(Boolean)
        .join(' ');

    return (
        <svg
            viewBox="0 0 100 100"
            width={size}
            height={size}
            className={svgClassName}
            aria-hidden="true"
            focusable="false"
        >
            <g className="agent-orbit-artwork" transform="translate(50 50) scale(1.34) translate(-50 -50)">
                <g className="agent-orbit-electron-group electron-1">
                    <circle className="agent-orbit-electron-glow" cx="67" cy="35" r="7.2" />
                    <circle className="agent-orbit-electron-core" cx="67" cy="35" r="4.2" />
                </g>

                <g className="agent-orbit-electron-group electron-2">
                    <circle className="agent-orbit-electron-glow" cx="33" cy="66" r="6.8" />
                    <circle className="agent-orbit-electron-core" cx="33" cy="66" r="3.9" />
                </g>

                <g className="agent-orbit-electron-group electron-3">
                    <circle className="agent-orbit-electron-glow" cx="74" cy="63" r="5.9" />
                    <circle className="agent-orbit-electron-core" cx="74" cy="63" r="3.2" />
                </g>

                <g className="agent-orbit-nucleus">
                    <circle className="agent-orbit-nucleus-glow" cx="50" cy="50" r="18" />
                    <circle className="agent-orbit-nucleus-core" cx="50" cy="50" r="10.5" />
                    <circle className="agent-orbit-nucleus-highlight" cx="46.5" cy="46.5" r="2.8" />
                </g>
            </g>
        </svg>
    );
};

export default AgentOrbitIcon;
