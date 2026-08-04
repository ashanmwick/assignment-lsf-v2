interface Props {
  from: string;
  to: string;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
}

export function TimeRangePicker({ from, to, onChangeFrom, onChangeTo }: Props) {
  return (
    <div className="panel">
      <label>
        Departs after
        <input type="time" value={from} onChange={(e) => onChangeFrom(e.target.value)} />
      </label>
      <label>
        Departs before
        <input type="time" value={to} onChange={(e) => onChangeTo(e.target.value)} />
      </label>
    </div>
  );
}
