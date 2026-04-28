CREATE POLICY "Admins can view view-as tokens"
ON public.view_as_tokens
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create view-as tokens"
ON public.view_as_tokens
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update view-as tokens"
ON public.view_as_tokens
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete view-as tokens"
ON public.view_as_tokens
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));