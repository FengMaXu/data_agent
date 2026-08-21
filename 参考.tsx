 @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";

export default function App() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="relative w-full max-w-2xl aspect-square flex items-center justify-center">
        <svg
          viewBox="0 0 400 400"
          className="w-full h-full drop-shadow-[0_0_10px_rgba(37,99,235,0.2)]"
        >
          {/* Nucleus */}
          <motion.circle
            cx="200"
            cy="200"
            r="12"
            fill="#1d4ed8"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Orbit 1 */}
          <g transform="rotate(0 200 200)">
            <motion.circle
              r="6"
              fill="#2563eb"
              animate={{
                cx: [200 + 150, 200, 200 - 150, 200, 200 + 150],
                cy: [200, 200 + 60, 200, 200 - 60, 200],
                opacity: [0, 1, 1, 0, 0, 1, 0],
                scale: [0, 1.2, 1, 0.5, 0, 1, 0],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "linear",
                times: [0, 0.25, 0.5, 0.75, 1],
                opacity: {
                  duration: 4,
                  repeat: Infinity,
                  times: [0, 0.1, 0.4, 0.5, 0.6, 0.9, 1],
                  values: [0, 1, 1, 0, 0, 1, 0]
                }
              }}
            />
          </g>

          {/* Orbit 2 */}
          <g transform="rotate(120 200 200)">
            <motion.circle
              r="6"
              fill="#3b82f6"
              animate={{
                cx: [200 + 150, 200, 200 - 150, 200, 200 + 150],
                cy: [200, 200 + 60, 200, 200 - 60, 200],
                opacity: [0, 1, 0, 1, 0],
                scale: [0, 1, 0, 1, 0],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "linear",
                delay: 1,
              }}
            />
          </g>

          {/* Orbit 3 */}
          <g transform="rotate(240 200 200)">
            <motion.circle
              r="6"
              fill="#60a5fa"
              animate={{
                cx: [200 + 150, 200, 200 - 150, 200, 200 + 150],
                cy: [200, 200 + 60, 200, 200 - 60, 200],
                opacity: [1, 0, 1, 0, 1],
                scale: [1, 0, 1, 0, 1],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "linear",
                delay: 2,
              }}
            />
          </g>
        </svg>
      </div>
    </div>
  );
}