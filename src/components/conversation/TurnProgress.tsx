import type { Stage } from '../../../shared/contracts'
import { Icon } from '../ui/Icon'

const stages: Stage[] = ['planning', 'researching', 'writing', 'validating']
const labels = {
  planning: 'Plan',
  researching: 'Research',
  writing: 'Report',
  validating: 'Check citations',
}

export function TurnProgress({
  stage,
  running,
  detail,
  draft,
}: {
  stage: Stage
  running: boolean
  detail: string
  draft: string
}) {
  const current = stages.indexOf(stage)
  return (
    <section className="live-report" aria-label="Report in progress">
      <div className="progress-stages">
        {stages.map((item, index) => (
          <span className={current >= index ? 'active' : ''} key={item}>
            <span>
              {current > index ? <Icon name="check" size={12} /> : index + 1}
            </span>
            {labels[item]}
          </span>
        ))}
      </div>
      <p role="status" className="progress-detail">
        <span className="pulse" />
        {running
          ? detail
          : 'A report is running in this session. You can stop it below.'}
      </p>
      {draft && (
        <div className="draft-text">
          {draft}
          <span className="cursor" />
        </div>
      )}
    </section>
  )
}
