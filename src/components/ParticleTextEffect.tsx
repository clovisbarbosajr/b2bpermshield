import { useEffect, useRef, useState } from "react";

interface Vector2D {
  x: number;
  y: number;
}

class Particle {
  pos: Vector2D = { x: 0, y: 0 };
  vel: Vector2D = { x: 0, y: 0 };
  acc: Vector2D = { x: 0, y: 0 };
  target: Vector2D = { x: 0, y: 0 };
  closeEnoughTarget = 100;
  maxSpeed = 1.0;
  maxForce = 0.1;
  particleSize = 10;
  isKilled = false;
  startColor = { r: 0, g: 0, b: 0 };
  targetColor = { r: 0, g: 0, b: 0 };
  colorWeight = 0;
  colorBlendRate = 0.01;

  move() {
    let proximityMult = 1;
    const distance = Math.sqrt(
      Math.pow(this.pos.x - this.target.x, 2) +
        Math.pow(this.pos.y - this.target.y, 2)
    );
    if (distance < this.closeEnoughTarget) {
      proximityMult = distance / this.closeEnoughTarget;
    }

    const towardsTarget = {
      x: this.target.x - this.pos.x,
      y: this.target.y - this.pos.y,
    };
    const magnitude = Math.sqrt(
      towardsTarget.x * towardsTarget.x + towardsTarget.y * towardsTarget.y
    );
    if (magnitude > 0) {
      towardsTarget.x =
        (towardsTarget.x / magnitude) * this.maxSpeed * proximityMult;
      towardsTarget.y =
        (towardsTarget.y / magnitude) * this.maxSpeed * proximityMult;
    }

    const steer = {
      x: towardsTarget.x - this.vel.x,
      y: towardsTarget.y - this.vel.y,
    };
    const steerMag = Math.sqrt(steer.x * steer.x + steer.y * steer.y);
    if (steerMag > 0) {
      steer.x = (steer.x / steerMag) * this.maxForce;
      steer.y = (steer.y / steerMag) * this.maxForce;
    }

    this.acc.x += steer.x;
    this.acc.y += steer.y;
    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    this.acc.x = 0;
    this.acc.y = 0;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.colorWeight < 1.0) {
      this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1.0);
    }
    const r = Math.round(
      this.startColor.r +
        (this.targetColor.r - this.startColor.r) * this.colorWeight
    );
    const g = Math.round(
      this.startColor.g +
        (this.targetColor.g - this.startColor.g) * this.colorWeight
    );
    const b = Math.round(
      this.startColor.b +
        (this.targetColor.b - this.startColor.b) * this.colorWeight
    );
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(this.pos.x, this.pos.y, 2, 2);
  }

  kill(width: number, height: number) {
    if (!this.isKilled) {
      const angle = Math.random() * Math.PI * 2;
      const mag = (width + height) / 2;
      this.target.x = width / 2 + Math.cos(angle) * mag;
      this.target.y = height / 2 + Math.sin(angle) * mag;
      this.startColor = {
        r:
          this.startColor.r +
          (this.targetColor.r - this.startColor.r) * this.colorWeight,
        g:
          this.startColor.g +
          (this.targetColor.g - this.startColor.g) * this.colorWeight,
        b:
          this.startColor.b +
          (this.targetColor.b - this.startColor.b) * this.colorWeight,
      };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;
      this.isKilled = true;
    }
  }
}

interface Props {
  text?: string;
  color?: { r: number; g: number; b: number };
}

const ParticleTextEffect = ({
  text = "Welcome to B2B Portal",
  color = { r: 14, g: 210, b: 218 },
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const settledRef = useRef(false);
  const framesSinceSettledRef = useRef(0);
  const [settled, setSettled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pixelSteps = 6;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    updateSize();

    const generateRandomPos = (
      cx: number,
      cy: number,
      mag: number
    ): Vector2D => {
      const angle = Math.random() * Math.PI * 2;
      return {
        x: cx + Math.cos(angle) * mag,
        y: cy + Math.sin(angle) * mag,
      };
    };

    const setupText = () => {
      const offscreen = document.createElement("canvas");
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext("2d")!;

      // Responsive font size
      const isMobile = canvas.width < 600;
      const fontSize = isMobile ? 28 : canvas.width < 900 ? 50 : 72;

      offCtx.fillStyle = "white";
      offCtx.font = `bold ${fontSize}px Arial`;
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";

      // Split text into lines if mobile
      if (isMobile) {
        const words = text.split(" ");
        const lines: string[] = [];
        let current = "";
        for (const w of words) {
          const test = current ? `${current} ${w}` : w;
          if (offCtx.measureText(test).width > canvas.width * 0.85) {
            lines.push(current);
            current = w;
          } else {
            current = test;
          }
        }
        if (current) lines.push(current);

        const lineHeight = fontSize * 1.3;
        const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, i) => {
          offCtx.fillText(line, canvas.width / 2, startY + i * lineHeight);
        });
      } else {
        offCtx.fillText(text, canvas.width / 2, canvas.height / 2);
      }

      const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const particles = particlesRef.current;
      let pIndex = 0;

      const coordsIndexes: number[] = [];
      for (let i = 0; i < pixels.length; i += pixelSteps * 4) {
        coordsIndexes.push(i);
      }

      // Shuffle
      for (let i = coordsIndexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [coordsIndexes[i], coordsIndexes[j]] = [
          coordsIndexes[j],
          coordsIndexes[i],
        ];
      }

      for (const ci of coordsIndexes) {
        const alpha = pixels[ci + 3];
        if (alpha > 0) {
          const x = (ci / 4) % canvas.width;
          const y = Math.floor(ci / 4 / canvas.width);

          let particle: Particle;
          if (pIndex < particles.length) {
            particle = particles[pIndex];
            particle.isKilled = false;
            pIndex++;
          } else {
            particle = new Particle();
            const rp = generateRandomPos(
              canvas.width / 2,
              canvas.height / 2,
              (canvas.width + canvas.height) / 2
            );
            particle.pos.x = rp.x;
            particle.pos.y = rp.y;
            particle.maxSpeed = Math.random() * 6 + 4;
            particle.maxForce = particle.maxSpeed * 0.05;
            particle.particleSize = Math.random() * 6 + 6;
            particle.colorBlendRate = Math.random() * 0.0275 + 0.0025;
            particles.push(particle);
          }

          particle.startColor = {
            r:
              particle.startColor.r +
              (particle.targetColor.r - particle.startColor.r) *
                particle.colorWeight,
            g:
              particle.startColor.g +
              (particle.targetColor.g - particle.startColor.g) *
                particle.colorWeight,
            b:
              particle.startColor.b +
              (particle.targetColor.b - particle.startColor.b) *
                particle.colorWeight,
          };
          particle.targetColor = color;
          particle.colorWeight = 0;
          particle.target.x = x;
          particle.target.y = y;
        }
      }

      for (let i = pIndex; i < particles.length; i++) {
        particles[i].kill(canvas.width, canvas.height);
      }
    };

    setupText();

    const animate = () => {
      if (settledRef.current) return;

      const ctx = canvas.getContext("2d")!;
      const particles = particlesRef.current;

      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let allSettled = true;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.move();
        p.draw(ctx);

        if (p.isKilled) {
          if (
            p.pos.x < 0 ||
            p.pos.x > canvas.width ||
            p.pos.y < 0 ||
            p.pos.y > canvas.height
          ) {
            particles.splice(i, 1);
          }
          continue;
        }

        const dx = p.pos.x - p.target.x;
        const dy = p.pos.y - p.target.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          allSettled = false;
        }
      }

      if (allSettled && particles.length > 0) {
        framesSinceSettledRef.current++;
        // Wait a few frames after all particles settle
        if (framesSinceSettledRef.current > 30) {
          settledRef.current = true;
          setSettled(true);
          // Final clean render
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const p of particles) {
            p.draw(ctx);
          }
          return;
        }
      } else {
        framesSinceSettledRef.current = 0;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [text, color]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[120px] sm:h-[150px] lg:h-[180px] rounded-lg overflow-hidden bg-black/80"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: "block" }}
      />
    </div>
  );
};

export default ParticleTextEffect;
