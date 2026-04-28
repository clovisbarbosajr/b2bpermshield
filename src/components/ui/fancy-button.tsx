import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface FancyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: React.ReactNode;
}

const FancyButton = forwardRef<HTMLButtonElement, FancyButtonProps>(
  ({ label, icon, className, ...props }, ref) => {
    return (
      <div className={cn("fancy-btn-container", className)}>
        <div className="fancy-btn-hover fancy-bt-1" />
        <div className="fancy-btn-hover fancy-bt-2" />
        <div className="fancy-btn-hover fancy-bt-3" />
        <div className="fancy-btn-hover fancy-bt-4" />
        <div className="fancy-btn-hover fancy-bt-5" />
        <div className="fancy-btn-hover fancy-bt-6" />
        <button ref={ref} {...props} className="fancy-btn-main">
          <span className="fancy-btn-content">
            {icon}
            {label}
          </span>
        </button>
      </div>
    );
  }
);

FancyButton.displayName = "FancyButton";

export { FancyButton };
