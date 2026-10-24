import { useEffect, useState } from "react";

const fetchStars = async (): Promise<number> => 42;

export const StarCount = () => {
  const [stars, setStars] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    fetchStars()
      .then((count) => setStars(count))
      .catch(() => setStars(null))
      .finally(() => setIsLoading(false));
  }, []);
  if (isLoading) return <p>Loading</p>;
  return <p>{stars === null ? "No stars" : "Stars"}</p>;
};
