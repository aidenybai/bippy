import Image from "next/image";

const placeholderSource = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///w==";

const LegacyImages = () => {
  const sharedImage = <Image src="/shared.png" width={16} height={16} />;
  return (
    <main>
      {sharedImage}
      {sharedImage}
      <Image src="/priority.png" width={16} height={16} priority />
      <Image src="/eager.png" width={16} height={16} loading="eager" />
      <Image src={placeholderSource} width={16} height={16} />
      <Image
        src="blob:fixture-image"
        width={16}
        height={16}
        loader={({ src: imageSource }) => imageSource}
      />
      <Image
        src="/blur.png"
        width={16}
        height={16}
        loading="eager"
        placeholder="blur"
        blurDataURL={placeholderSource}
      />
    </main>
  );
};

export default LegacyImages;
