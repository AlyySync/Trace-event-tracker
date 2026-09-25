import type { CSSProperties } from 'react';
import { Clock3, LoaderCircle, Pause, Play, Square } from 'lucide-react';
import { durationLabel } from './tracking';
import './session-timer.css';

type Props = {
  elapsedMs: number;
  running: boolean;
  hasSession: boolean;
  label: string;
  disabled: boolean;
  connecting: boolean;
  onToggle: () => void;
  onFinish: () => void;
};

export default function SessionTimer({
  elapsedMs,
  running,
  hasSession,
  label,
  disabled,
  connecting,
  onToggle,
  onFinish,
}: Props) {
  const [hours, minutes, seconds] = durationLabel(elapsedMs, true).split(':');
  const second = Number(seconds);
  const status = connecting
    ? 'Connecting'
    : running
      ? 'In the flow'
      : hasSession
        ? 'On a pause'
        : 'Ready when you are';

  return (
    <section
      className={`panel session-timer ${running ? 'timer-running' : ''}`}
      aria-label="Session stopwatch"
    >
      <div className="session-timer-copy">
        <div className="session-timer-eyebrow">
          <Clock3 size={15} />
          Session timer
          <span>STOPWATCH</span>
        </div>
        <h2>{label.trim() || 'Make time for your work.'}</h2>
        <p>
          {running
            ? 'Your session is unfolding. Every second, accounted for.'
            : hasSession
              ? 'Take your time. Pick up right where you left off.'
              : 'A little focus. A little progress. One session at a time.'}
        </p>
        <div className="session-timer-controls">
          <button
            className={`primary-button ${running ? 'recording' : ''}`}
            onClick={onToggle}
            disabled={disabled}
          >
            {connecting ? (
              <LoaderCircle size={17} className="spin" />
            ) : running ? (
              <Pause size={17} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {connecting
              ? 'Connecting…'
              : running
                ? 'Pause session'
                : hasSession
                  ? 'Resume session'
                  : 'Start session'}
          </button>
          {hasSession && (
            <button
              className="stop-button"
              onClick={onFinish}
              disabled={disabled}
              aria-label="Finish timed session"
            >
              <Square size={13} fill="currentColor" />
              Finish
            </button>
          )}
        </div>
        <span className="session-timer-note">
          <i className={running ? 'live-dot' : ''} />
          {running
            ? 'Screen tracking & random captures are on'
            : hasSession
              ? 'Time and screen captures are paused'
              : 'Starts when your screen connects'}
        </span>
      </div>

      <div className="session-timer-face">
        <div className="session-timer-halo" aria-hidden="true" />
        <svg
          className="session-timer-dial"
          viewBox="0 0 300 300"
          aria-hidden="true"
        >
          <circle cx="150" cy="150" r="132" className="session-timer-track" />
          {Array.from({ length: 60 }, (_, index) => (
            <line
              key={index}
              x1="150"
              y1={index % 5 === 0 ? 5 : 9}
              x2="150"
              y2="15"
              transform={`rotate(${index * 6} 150 150)`}
              className={
                index % 5 === 0 ? 'timer-tick timer-tick-major' : 'timer-tick'
              }
            />
          ))}
          <circle
            cx="150"
            cy="150"
            r="132"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - (second / 60) * 100}
            transform="rotate(-90 150 150)"
            className="session-timer-progress"
          />
        </svg>
        <div
          className="session-timer-hand"
          style={{ '--second-angle': `${second * 6}deg` } as CSSProperties}
          aria-hidden="true"
        >
          <i />
        </div>
        <div className="session-timer-center">
          <span className="session-timer-state">
            <i />
            {status}
          </span>
          <time
            className={`session-timer-digits ${hours.length > 2 ? 'timer-long' : ''}`}
            role="timer"
            aria-live="off"
            aria-label={`${hours} hours, ${minutes} minutes, ${seconds} seconds`}
            dateTime={`PT${Math.floor(elapsedMs / 1000)}S`}
            data-testid="session-stopwatch"
          >
            {hours}
            <b>:</b>
            {minutes}
            <span>
              <b>:</b>
              {seconds}
            </span>
          </time>
          <span className="session-timer-units">hours · minutes · seconds</span>
        </div>
        <span className="session-timer-caption">TIME, WELL SPENT</span>
      </div>
    </section>
  );
}
